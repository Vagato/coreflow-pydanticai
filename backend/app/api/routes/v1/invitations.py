"""Invitation routes — not configured (enable_teams=false or no JWT)."""

from fastapi import APIRouter

org_router = APIRouter()
token_router = APIRouter()
