"use client";
import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronRight, Folder, FolderOpen, FileText, FilePlus, FolderPlus, Trash2, MoreHorizontal,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { projectsApi, filesApi } from "@/lib/api";
import { useFileStore } from "@/stores/file-store";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { ProjectFile } from "@/lib/types";

interface TreeNode {
  name: string;
  path: string;
  file?: ProjectFile;
  children: TreeNode[];
}

function buildTree(files: ProjectFile[]): TreeNode {
  const root: TreeNode = { name: "/", path: "", children: [] };
  for (const f of files) {
    const segs = f.path.replace(/^\/+/, "").split("/");
    let node = root;
    for (let i = 0; i < segs.length; i++) {
      const isLast = i === segs.length - 1;
      const seg = segs[i];
      const path = segs.slice(0, i + 1).join("/");
      let child = node.children.find((c) => c.name === seg);
      if (!child) {
        child = { name: seg, path, children: [] };
        node.children.push(child);
      }
      if (isLast) child.file = f;
      node = child;
    }
  }
  // Sort: folders first, then files, alphabetical
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => {
      const aFolder = !a.file ? 0 : 1;
      const bFolder = !b.file ? 0 : 1;
      if (aFolder !== bFolder) return aFolder - bFolder;
      return a.name.localeCompare(b.name);
    });
    n.children.forEach(sort);
  };
  sort(root);
  return root;
}

export function FileTree({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const { openTab } = useFileStore();
  const { data: files = [], isLoading } = useQuery({
    queryKey: ["files", projectId],
    queryFn: () => projectsApi.listFiles(projectId),
  });

  const tree = React.useMemo(() => buildTree(files), [files]);

  async function openFile(f: ProjectFile) {
    try {
      const fresh = await filesApi.get(f.id);
      openTab(fresh);
    } catch (e) {
      push({ kind: "error", message: (e as Error).message });
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b hairline flex items-center gap-2">
        <span className="text-xs font-medium text-ink">Files</span>
        <div className="flex-1" />
        <CreateFileDialog projectId={projectId} onCreated={() => qc.invalidateQueries({ queryKey: ["files", projectId] })} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-1.5">
        {isLoading && <div className="px-2 py-1 text-xs text-ink-faint">Loading...</div>}
        {!isLoading && tree.children.length === 0 && (
          <div className="px-2 py-2 text-[11px] text-ink-faint">No files yet. Create one above.</div>
        )}
        {tree.children.map((n) => (
          <TreeRow key={n.path} node={n} depth={0} onOpen={openFile} projectId={projectId} />
        ))}
      </div>
    </div>
  );
}

function TreeRow({ node, depth, onOpen, projectId }: { node: TreeNode; depth: number; onOpen: (f: ProjectFile) => void; projectId: string }) {
  const isFolder = !node.file;
  const [open, setOpen] = React.useState(depth < 1);
  const qc = useQueryClient();
  const { push } = useToast();

  const del = useMutation({
    mutationFn: () => filesApi.delete(node.file!.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["files", projectId] }),
    onError: (e) => push({ kind: "error", message: (e as Error).message }),
  });

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1.5 px-2 py-1 rounded-md text-[12.5px] text-ink-muted hover:text-ink hover:bg-white/[0.05] transition cursor-pointer",
        )}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => (isFolder ? setOpen(!open) : onOpen(node.file!))}
      >
        {isFolder ? (
          <>
            <ChevronRight size={12} className={cn("transition-transform", open && "rotate-90")} />
            {open ? <FolderOpen size={13} className="text-amber-300" /> : <Folder size={13} className="text-amber-300" />}
          </>
        ) : (
          <>
            <span className="w-3" />
            <FileText size={13} className="text-sky-300" />
          </>
        )}
        <span className="truncate flex-1">{node.name}</span>
        {!isFolder && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <button className="opacity-0 group-hover:opacity-100 transition text-ink-faint hover:text-ink p-0.5">
                <MoreHorizontal size={12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onOpen(node.file!)}>Open</DropdownMenuItem>
              <DropdownMenuItem className="text-danger" onClick={() => del.mutate()}>
                <Trash2 size={12} /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <AnimatePresence initial={false}>
        {isFolder && open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            {node.children.map((c) => (
              <TreeRow key={c.path} node={c} depth={depth + 1} onOpen={onOpen} projectId={projectId} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CreateFileDialog({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [path, setPath] = React.useState("");
  const { push } = useToast();
  const create = useMutation({
    mutationFn: () => {
      const cleaned = path.trim().replace(/^\/+/, "");
      const name = cleaned.split("/").pop() || "untitled.txt";
      return projectsApi.createFile(projectId, { path: cleaned, name, content: "", mime_type: "text/plain" });
    },
    onSuccess: () => { setOpen(false); setPath(""); onCreated(); push({ kind: "success", message: "File created" }); },
    onError: (e) => push({ kind: "error", message: (e as Error).message }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" title="New file"><FilePlus size={13} /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New file</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (path.trim()) create.mutate(); }} className="space-y-3">
          <div>
            <label className="text-xs text-ink-muted">Path</label>
            <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="src/index.ts" autoFocus className="mt-1 font-mono text-xs" />
            <p className="text-[10px] text-ink-faint mt-1">Use slashes to create folders, e.g. <span className="font-mono">app/main.py</span>.</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button type="submit" disabled={!path.trim() || create.isPending}>Create</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
