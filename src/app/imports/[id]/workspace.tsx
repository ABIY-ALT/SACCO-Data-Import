"use client";

import { useParams } from "next/navigation";
import { ImportWorkspace } from "@/components/import/import-wizard";

export function WorkspaceFromParams() {
  const { id } = useParams<{ id: string }>();
  // key: a fresh workspace (and state) per import
  return <ImportWorkspace key={id} id={id} />;
}
