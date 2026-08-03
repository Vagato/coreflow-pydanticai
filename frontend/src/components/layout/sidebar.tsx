"use client";

import { useSidebarStore } from "@/stores";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from "@/components/ui";
import { APP_NAME } from "@/lib/constants";

/**
 * Main sidebar — currently unused (nav links moved to header).
 * Kept as a minimal shell in case we add more items later.
 */
export function Sidebar() {
  const { isOpen, close } = useSidebarStore();

  return (
    <Sheet open={isOpen} onOpenChange={close}>
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="h-14 px-4">
          <SheetTitle>{APP_NAME}</SheetTitle>
          <SheetClose onClick={close} />
        </SheetHeader>
      </SheetContent>
    </Sheet>
  );
}
