import logging
from collections.abc import AsyncGenerator, Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.capabilities import (
    ReinjectSystemPrompt,
    Thinking,
    WebFetch,
    WebSearch,
)
from pydantic_ai.messages import (
    ModelRequest,
    ModelResponse,
    SystemPromptPart,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.settings import ModelSettings
from pydantic_ai_skills import SkillsToolset
from pydantic_ai_summarization import ContextManagerCapability
from pydantic_ai_todo import TodoCapability
from subagents_pydantic_ai import SubAgentCapability

from app.agents.prompts import (
    get_research_prompt,
    get_system_prompt_with_rag,
)
from app.agents.tools.ask_user_tool import MAX_QUESTIONS, QuestionItem, format_answers
from app.agents.tools.chart_tool import ChartType, create_chart
from app.agents.tools.code_execution import run_python as run_python_code
from app.agents.tools.rag_tool import search_knowledge_base
from app.agents.utils import get_current_datetime
from app.core.config import settings

logger = logging.getLogger(__name__)

_hindsight_configured: bool = False


def _ensure_hindsight_configured() -> None:
    """Call ``configure()`` once so ``create_hindsight_tools()`` picks up
    the API URL and key from global defaults."""
    global _hindsight_configured
    if _hindsight_configured:
        return
    if not settings.HINDSIGHT_ENABLED:
        return
    from hindsight_pydantic_ai import configure

    configure(
        hindsight_api_url=settings.HINDSIGHT_API_BASE,
        api_key=settings.HINDSIGHT_API_KEY,
    )
    _hindsight_configured = True
    logger.info("Hindsight configured: %s", settings.HINDSIGHT_API_BASE)


def _build_model(model_name: str) -> OpenAIChatModel:
    """OpenAI-compatible deployment (OpenAI, DeepSeek, etc.).

    Uses the Chat Completions API (NOT the Responses API) because most
    OpenAI-compatible providers (DeepSeek, etc.) only implement
    /v1/chat/completions.
    """
    provider_kwargs = {"api_key": settings.OPENAI_API_KEY}
    base_url = getattr(settings, "OPENAI_BASE_URL", None)
    if base_url:
        provider_kwargs["base_url"] = base_url
    return OpenAIChatModel(
        model_name or settings.AI_MODEL,
        provider=OpenAIProvider(**provider_kwargs),
    )


AskUserCallback = Callable[[list[dict[str, Any]]], Awaitable[list[dict[str, Any]]]]


@dataclass
class Deps:
    """Dependencies passed to tools via RunContext."""

    user_id: str | None = None
    user_name: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    ask_user: AskUserCallback | None = None
    # Required by SubAgentDepsProtocol; kept empty (capabilities carry the agents).
    subagents: dict[str, Any] = field(default_factory=dict)

    def clone_for_subagent(self, max_depth: int = 0) -> "Deps":
        """Create isolated deps for a delegated subagent (required by SubAgentDepsProtocol)."""
        return Deps(
            user_id=self.user_id,
            user_name=self.user_name,
            metadata=self.metadata,
            ask_user=None,
            subagents={} if max_depth <= 0 else self.subagents,
        )


class AssistantAgent:
    def __init__(
        self,
        model_name: str | None = None,
        temperature: float | None = None,
        system_prompt: str | None = None,
        thinking_effort: str | None = None,
        extra_toolsets: list[Any] | None = None,
        deep_research: bool = False,
        todo_capability: "TodoCapability | None" = None,
        subagent_capability: "SubAgentCapability | None" = None,
        context_manager_capability: "ContextManagerCapability | None" = None,
        hindsight_bank_id: str | None = None,
    ):
        self.deep_research = deep_research
        self.todo_capability = todo_capability
        self.subagent_capability = subagent_capability
        self.context_manager_capability = context_manager_capability
        self.extra_toolsets = extra_toolsets or []
        self.hindsight_bank_id = hindsight_bank_id
        self.model_name = model_name or settings.AI_MODEL
        # ``temperature`` stays ``None`` when caller didn't set it — don't fall
        # back to settings.AI_TEMPERATURE here. Reasoning/o-series models
        # (gpt-5.5, o1, …) reject the parameter entirely, so we only forward
        # it to the model when explicitly requested.
        self.temperature = temperature
        self.thinking_effort = (
            thinking_effort
            if thinking_effort is not None
            else (settings.AI_THINKING_EFFORT if settings.AI_THINKING_ENABLED else None)
        )
        self.system_prompt = system_prompt or get_system_prompt_with_rag()
        if deep_research:
            self.system_prompt = system_prompt or get_research_prompt()
        self._agent: Agent[Deps, str] | None = None

    def _create_agent(self) -> Agent[Deps, str]:
        model = _build_model(self.model_name)

        capabilities: list[Any] = [ReinjectSystemPrompt()]
        # DeepSeek thinking mode requires extra_body={"thinking": {"type": "enabled"}}
        # which pydantic-ai's generic Thinking() capability does not inject.
        # Skip the generic Thinking capability; DeepSeek's native CoT is
        # controlled at the model level via reasoning_effort when available.
        if self.thinking_effort and "deepseek" not in self.model_name.lower():
            capabilities.append(Thinking(effort=self.thinking_effort))
        # Local DuckDuckGo / fetch (the installed extras) — works uniformly across
        # all providers, unlike provider-native web search.
        if not self.deep_research:
            capabilities.append(WebSearch(native=False, local="duckduckgo"))
            capabilities.append(WebFetch(native=False, local=True))

        model_settings: ModelSettings = ModelSettings()
        if self.temperature is not None:
            model_settings["temperature"] = self.temperature
        toolsets: list[Any] = []
        tools: list[Any] = []

        skills_dir = Path(__file__).parent.parent.parent / "skills"
        if skills_dir.exists():
            toolsets.append(SkillsToolset(directories=[str(skills_dir)]))

        # MCP servers (deployment-managed + the user's Settings → Integrations
        # connections) resolved for this turn; see build_toolsets_for_user.
        toolsets.extend(self.extra_toolsets)

        # Hindsight long-term memory — tools only, agent decides when to call
        if settings.HINDSIGHT_ENABLED and self.hindsight_bank_id:
            _ensure_hindsight_configured()
            from hindsight_pydantic_ai import create_hindsight_tools

            tools.extend(
                create_hindsight_tools(
                    bank_id=self.hindsight_bank_id,
                    include_reflect=False,
                )
            )

        if self.todo_capability is not None:
            capabilities.append(self.todo_capability)
        if self.subagent_capability is not None:
            capabilities.append(self.subagent_capability)
        # Context manager must be last — summarization-pydantic-ai requires it.
        if self.context_manager_capability is not None:
            capabilities.append(self.context_manager_capability)

        agent = Agent[Deps, str](
            model=model,
            model_settings=model_settings,
            system_prompt=self.system_prompt,
            capabilities=capabilities,
            toolsets=toolsets,
            tools=tools,
        )

        self._register_tools(agent)

        return agent

    def _register_tools(self, agent: Agent[Deps, str]) -> None:
        @agent.tool_plain
        def current_datetime() -> dict[str, str]:
            """Get the current date and time.

            Use this tool when you need to know the current date or time.
            """
            return get_current_datetime()

        @agent.tool
        async def search_documents(ctx: RunContext[Deps], query: str, top_k: int = 5) -> str:
            """Search the knowledge base for relevant documents.

            Use this tool to find information from uploaded documents before answering user queries.
            Cite sources by referring to the document filename from the search results.

            Args:
                query: The search query string.
                top_k: Number of top results to retrieve (default: 5).

            Returns:
                Formatted string with search results including content and scores.
            """
            try:
                return await search_knowledge_base(query=query, top_k=top_k)
            except Exception as e:
                raise ModelRetry("Knowledge base temporarily unavailable, please try again.") from e

        @agent.tool_plain
        def create_chart_tool(
            chart_type: ChartType,
            title: str,
            data: list[dict[str, Any]],
            series: list[dict[str, Any]] | None = None,
            x_key: str = "x",
            style: dict[str, Any] | None = None,
        ) -> str:
            """Create a chart (line/bar/pie/area/scatter) to visualize data for the user.

            Use whenever the user asks to plot, chart, graph, or visualize numbers,
            trends, comparisons, or distributions. Do not repeat the returned JSON
            back to the user — just briefly describe the chart you created.

            Args:
                chart_type: One of "line", "bar", "pie", "area", "scatter".
                title: Short chart title.
                data: Row dicts, e.g. [{"x": "Jan", "revenue": 120}]. For pie:
                    [{"x": "Chrome", "value": 64}, ...].
                series: Optional [{"key", "label"?, "color"?}] selecting fields to plot.
                x_key: Row field for the x-axis / pie label (default "x").
                style: Optional {"palette", "grid", "legend", "x_label", "y_label", "stacked"}.
            """
            return create_chart(
                chart_type=chart_type,
                title=title,
                data=data,
                series=series,
                x_key=x_key,
                style=style,
            )

        @agent.tool
        async def ask_user(ctx: RunContext[Deps], questions: list[QuestionItem]) -> str:
            """Ask the user one or more questions and wait for their answers.

            Use this when a decision or missing detail would materially change what
            you do next and you can't reasonably assume it. You may pass several
            questions at once — the user answers them one after another and you get
            all the answers back together (good for an intake/setup flow). You can
            also call this again later to follow up on what they said. Prefer
            answering directly when the request is already clear.

            Args:
                questions: The questions to ask. Each has the question text, optional
                    suggested `options`, and `allow_custom` (whether a free-form
                    answer is allowed, default True).

            Returns:
                The user's answers as a Q/A transcript, with skipped questions marked.
            """
            if ctx.deps.ask_user is None:
                return (
                    "User interaction is unavailable here; proceed with a reasonable "
                    "assumption and state it briefly."
                )
            if not questions:
                return "No questions were provided."
            payload = [q.model_dump() for q in questions[:MAX_QUESTIONS]]
            answers = await ctx.deps.ask_user(payload)
            return format_answers(payload, answers)

        @agent.tool
        async def run_python(ctx: RunContext[Deps], code: str) -> str:
            """Run Python in a sandbox and return its output.

            Use for multi-step number-crunching (projections, aggregations, simulations).
            SANDBOX LIMITATIONS — violating these causes "Execution failed" errors:
              - NO comma thousands separator in f-strings: ``{x:,}`` or ``{x:,.2f}``
                CRASHES. Use ``f"${int(x)}"`` or ``f"{x:.2f}"`` instead.
              - NO ``statistics``, ``random``, ``itertools``, ``collections``,
                numpy, pandas — compute stats manually with loops/math.
              - NO file I/O, network calls, or OS access.
              - NO ``import`` of any module not in: math, asyncio, json, datetime, re.
              - Walrus operator ``:=`` is unsupported.
              - f-string expressions must be simple: no ``!r``, no ``=`` suffix
                (``{x=}`` debug format crashes). Use ``print(f"x = {x}")``.

            Args:
                code: The Python source to execute.

            Returns:
                The captured stdout plus the final expression value, or an error
                message you can read and fix.
            """
            return await run_python_code(code)

    @staticmethod
    def _build_model_history(
        history: list[dict[str, str]] | None,
    ) -> list[ModelRequest | ModelResponse]:
        model_history: list[ModelRequest | ModelResponse] = []
        for msg in history or []:
            if msg["role"] == "user":
                model_history.append(ModelRequest(parts=[UserPromptPart(content=msg["content"])]))
            elif msg["role"] == "assistant":
                model_history.append(ModelResponse(parts=[TextPart(content=msg["content"])]))
            elif msg["role"] == "system":
                model_history.append(ModelRequest(parts=[SystemPromptPart(content=msg["content"])]))
        return model_history

    @property
    def agent(self) -> Agent[Deps, str]:
        if self._agent is None:
            self._agent = self._create_agent()
        return self._agent

    async def run(
        self,
        user_input: str,
        history: list[dict[str, str]] | None = None,
        deps: Deps | None = None,
    ) -> tuple[str, list[ToolCallPart | ToolReturnPart], Deps]:
        agent_deps = deps if deps is not None else Deps()

        logger.info("Running agent with user input: %s...", user_input[:100])
        result = await self.agent.run(
            user_input,
            deps=agent_deps,
            message_history=self._build_model_history(history),
        )

        tool_events: list[ToolCallPart | ToolReturnPart] = []
        for message in result.all_messages():
            if hasattr(message, "parts"):
                for part in message.parts:
                    if isinstance(part, (ToolCallPart, ToolReturnPart)):
                        tool_events.append(part)

        logger.info("Agent run complete. Output length: %s chars", len(result.output))

        return result.output, tool_events, agent_deps

    async def iter(
        self,
        user_input: str,
        history: list[dict[str, str]] | None = None,
        deps: Deps | None = None,
    ) -> AsyncGenerator[Any, None]:
        agent_deps = deps if deps is not None else Deps()

        async with self.agent.iter(
            user_input,
            deps=agent_deps,
            message_history=self._build_model_history(history),
        ) as run:
            async for event in run:
                yield event


def get_agent(
    model_name: str | None = None,
    thinking_effort: str | None = None,
    temperature: float | None = None,
    extra_toolsets: list[Any] | None = None,
    deep_research: bool = False,
    todo_capability: "TodoCapability | None" = None,
    subagent_capability: "SubAgentCapability | None" = None,
    context_manager_capability: "ContextManagerCapability | None" = None,
    hindsight_bank_id: str | None = None,
) -> AssistantAgent:
    return AssistantAgent(
        model_name=model_name,
        thinking_effort=thinking_effort,
        temperature=temperature,
        extra_toolsets=extra_toolsets,
        deep_research=deep_research,
        todo_capability=todo_capability,
        subagent_capability=subagent_capability,
        context_manager_capability=context_manager_capability,
        hindsight_bank_id=hindsight_bank_id,
    )


async def run_agent(
    user_input: str,
    history: list[dict[str, str]],
    deps: Deps | None = None,
) -> tuple[str, list[ToolCallPart | ToolReturnPart], Deps]:
    agent = get_agent()
    return await agent.run(user_input, history, deps)
