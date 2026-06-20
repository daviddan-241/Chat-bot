import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderOpen, Upload, Download, Trash2, File, Loader2, CloudUpload,
  FileText, FileImage, FileVideo, FileAudio, FileCode, X, Check
} from "lucide-react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

interface UploadedFile {
  id: number;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ mimeType }: { mimeType: string }) {
  const cls = "flex-shrink-0";
  if (mimeType.startsWith("image/")) return <FileImage size={16} className={`${cls} text-blue-400`} />;
  if (mimeType.startsWith("video/")) return <FileVideo size={16} className={`${cls} text-purple-400`} />;
  if (mimeType.startsWith("audio/")) return <FileAudio size={16} className={`${cls} text-pink-400`} />;
  if (mimeType.includes("pdf") || mimeType.includes("text")) return <FileText size={16} className={`${cls} text-amber-400`} />;
  if (mimeType.includes("json") || mimeType.includes("javascript") || mimeType.includes("python")) return <FileCode size={16} className={`${cls} text-green-400`} />;
  return <File size={16} className={`${cls} text-muted-foreground`} />;
}

function getExt(name: string) { return name.split(".").pop()?.toUpperCase() || "FILE"; }

export default function FilesPage() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    const r = await fetch(`${API}/api/files`);
    const d = await r.json();
    setFiles(d.files || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const uploadFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i]!;
      setUploadProgress(`Uploading ${file.name} (${i + 1}/${fileList.length})...`);
      const form = new FormData();
      form.append("file", file);
      await fetch(`${API}/api/files/upload`, { method: "POST", body: form });
    }
    setUploadProgress(null);
    setUploading(false);
    loadFiles();
  };

  const deleteFile = async (id: number) => {
    setDeleting(id);
    await fetch(`${API}/api/files/${id}`, { method: "DELETE" });
    setFiles(f => f.filter(x => x.id !== id));
    setDeleting(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    uploadFiles(e.dataTransfer.files);
  };

  const totalSize = files.reduce((acc, f) => acc + f.size, 0);

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="border-b border-border/50 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold flex items-center gap-2">
              <FolderOpen size={18} className="text-primary" /> File Manager
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {files.length} {files.length === 1 ? "file" : "files"} · {formatBytes(totalSize)} total
            </p>
          </div>
          <button onClick={() => inputRef.current?.click()} disabled={uploading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/85 disabled:opacity-50 transition-all shadow-sm">
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploading ? "Uploading..." : "Upload"}
          </button>
        </div>
        <input ref={inputRef} type="file" multiple className="hidden"
          onChange={e => uploadFiles(e.target.files)} />
      </div>

      {/* Drop zone + content */}
      <div className="flex-1 overflow-y-auto p-6"
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}>

        {/* Upload progress */}
        <AnimatePresence>
          {uploadProgress && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl bg-primary/8 border border-primary/20 text-primary text-sm">
              <Loader2 size={15} className="animate-spin" />
              {uploadProgress}
            </motion.div>
          )}
        </AnimatePresence>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-muted-foreground" /></div>
        ) : files.length === 0 ? (
          /* Empty drop zone */
          <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            onClick={() => inputRef.current?.click()}
            className={`w-full border-2 border-dashed rounded-2xl p-12 flex flex-col items-center gap-4 transition-all
              ${dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/20"}`}>
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-colors ${dragging ? "bg-primary/15" : "bg-muted/40"}`}>
              <CloudUpload size={28} className={dragging ? "text-primary" : "text-muted-foreground"} />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-foreground mb-1">Drop files here</p>
              <p className="text-xs text-muted-foreground">or click to browse · Any file type supported</p>
            </div>
          </motion.button>
        ) : (
          <>
            {/* Drop overlay */}
            {dragging && (
              <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                <div className="text-center p-8 rounded-3xl border-2 border-dashed border-primary bg-primary/10">
                  <CloudUpload size={48} className="text-primary mx-auto mb-3" />
                  <p className="text-lg font-semibold text-white">Drop to upload</p>
                </div>
              </div>
            )}

            {/* File table */}
            <div className="bg-card border border-card-border rounded-2xl overflow-hidden">
              <div className="grid grid-cols-12 gap-3 px-4 py-2.5 border-b border-border/50 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                <div className="col-span-6">Name</div>
                <div className="col-span-2 text-right">Size</div>
                <div className="col-span-2 hidden sm:block text-center">Type</div>
                <div className="col-span-2 text-right">Actions</div>
              </div>
              <div className="divide-y divide-border/30">
                {files.map((file, i) => (
                  <motion.div key={file.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="grid grid-cols-12 gap-3 px-4 py-3 items-center hover:bg-muted/20 transition-colors group">
                    <div className="col-span-6 flex items-center gap-3 min-w-0">
                      <FileIcon mimeType={file.mimeType} />
                      <div className="min-w-0">
                        <p className="text-sm text-foreground truncate font-medium">{file.originalName}</p>
                        <p className="text-[10px] text-muted-foreground/50">
                          {new Date(file.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="col-span-2 text-right text-xs text-muted-foreground">
                      {formatBytes(file.size)}
                    </div>
                    <div className="col-span-2 hidden sm:flex justify-center">
                      <span className="text-[9px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">
                        {getExt(file.originalName)}
                      </span>
                    </div>
                    <div className="col-span-2 flex items-center justify-end gap-1.5">
                      <a href={`${API}/api/files/download/${file.id}`} download={file.originalName}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors opacity-0 group-hover:opacity-100">
                        <Download size={13} />
                      </a>
                      <button onClick={() => deleteFile(file.id)} disabled={deleting === file.id}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50">
                        {deleting === file.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Upload more */}
            <div className="mt-4">
              <button onClick={() => inputRef.current?.click()}
                className={`w-full border-2 border-dashed rounded-xl px-4 py-3 flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-all
                  ${dragging ? "border-primary bg-primary/5 text-primary" : "border-border"}`}>
                <CloudUpload size={16} /> Drop more files or click to upload
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
