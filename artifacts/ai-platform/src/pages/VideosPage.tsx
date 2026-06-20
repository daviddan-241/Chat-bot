import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Video, Play, Loader2, CheckCircle, XCircle, Clock, Scissors, Volume2, Minimize2, Image as ImageIcon, RefreshCw, ChevronRight } from "lucide-react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

interface VideoJob {
  id: number;
  operation: string;
  inputPath: string;
  outputPath: string | null;
  status: "queued" | "running" | "completed" | "failed";
  error: string | null;
  createdAt: string;
}

const OPERATIONS = [
  { id: "compress", label: "Compress", icon: <Minimize2 size={18} />, desc: "Reduce file size with H.264", color: "from-blue-500 to-cyan-500", fields: [] },
  { id: "extract_audio", label: "Extract Audio", icon: <Volume2 size={18} />, desc: "Export audio as MP3", color: "from-green-500 to-teal-500", fields: [] },
  { id: "convert_mp4", label: "Convert to MP4", icon: <Video size={18} />, desc: "Convert any format to MP4", color: "from-violet-500 to-purple-500", fields: [] },
  { id: "trim", label: "Trim", icon: <Scissors size={18} />, desc: "Cut video to duration", color: "from-amber-500 to-orange-500", fields: [
    { key: "start", label: "Start (seconds)", default: "0" },
    { key: "duration", label: "Duration (seconds)", default: "30" },
  ]},
  { id: "resize", label: "Resize", icon: <ImageIcon size={18} />, desc: "Rescale dimensions", color: "from-pink-500 to-rose-500", fields: [
    { key: "width", label: "Width (px)", default: "1280" },
    { key: "height", label: "Height (px)", default: "720" },
  ]},
  { id: "thumbnail", label: "Thumbnail", icon: <ImageIcon size={18} />, desc: "Extract frame as JPEG", color: "from-indigo-500 to-blue-500", fields: [] },
];

const STATUS_CONFIG = {
  queued: { icon: <Clock size={12} />, cls: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20", label: "Queued" },
  running: { icon: <Loader2 size={12} className="animate-spin" />, cls: "text-blue-400 bg-blue-400/10 border-blue-400/20", label: "Running" },
  completed: { icon: <CheckCircle size={12} />, cls: "text-green-400 bg-green-400/10 border-green-400/20", label: "Done" },
  failed: { icon: <XCircle size={12} />, cls: "text-red-400 bg-red-400/10 border-red-400/20", label: "Failed" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.queued;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium ${s.cls}`}>
      {s.icon} {s.label}
    </span>
  );
}

export default function VideosPage() {
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOp, setSelectedOp] = useState(OPERATIONS[0]!);
  const [inputPath, setInputPath] = useState("");
  const [outputName, setOutputName] = useState("");
  const [opOptions, setOpOptions] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const loadJobs = async () => {
    try {
      const r = await fetch(`${API}/api/videos/jobs`);
      const d = await r.json();
      setJobs(d.jobs || []);
    } catch (_) {}
    setLoading(false);
  };

  useEffect(() => {
    loadJobs();
    const t = setInterval(loadJobs, 3000);
    return () => clearInterval(t);
  }, []);

  const submit = async () => {
    if (!inputPath.trim()) { setMsg({ type: "err", text: "Please enter an input file path" }); return; }
    setSubmitting(true);
    setMsg(null);
    try {
      const r = await fetch(`${API}/api/videos/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: selectedOp.id, inputPath: inputPath.trim(), outputName: outputName.trim() || undefined, options: opOptions }),
      });
      const d = await r.json();
      if (d.jobId) {
        setMsg({ type: "ok", text: `Job #${d.jobId} started successfully` });
        loadJobs();
      } else {
        setMsg({ type: "err", text: d.error || "Failed to start job" });
      }
    } catch (_) { setMsg({ type: "err", text: "Request failed — check the server" }); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="h-full flex overflow-hidden bg-background">
      {/* Left panel */}
      <div className="w-80 border-r border-border/50 flex flex-col flex-shrink-0 bg-card/20">
        <div className="px-4 py-4 border-b border-border/50">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Video size={16} className="text-primary" /> Video Tools
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">FFmpeg-powered processing</p>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {/* Operation cards */}
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">Select Operation</p>
          {OPERATIONS.map(op => (
            <button key={op.id} onClick={() => { setSelectedOp(op); setOpOptions({}); setMsg(null); }}
              className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all
                ${selectedOp.id === op.id ? "border-primary/40 bg-primary/8" : "border-border/40 hover:border-primary/20 hover:bg-muted/30"}`}>
              <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${op.color} flex items-center justify-center text-white flex-shrink-0`}>
                {op.icon}
              </div>
              <div className="min-w-0">
                <p className={`text-xs font-semibold ${selectedOp.id === op.id ? "text-primary" : "text-foreground"}`}>{op.label}</p>
                <p className="text-[10px] text-muted-foreground truncate">{op.desc}</p>
              </div>
              {selectedOp.id === op.id && <ChevronRight size={12} className="text-primary ml-auto flex-shrink-0" />}
            </button>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Config */}
          <div className="bg-card border border-card-border rounded-2xl p-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${selectedOp.color} flex items-center justify-center text-white`}>
                {selectedOp.icon}
              </div>
              <div>
                <h3 className="text-sm font-semibold">{selectedOp.label}</h3>
                <p className="text-xs text-muted-foreground">{selectedOp.desc}</p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground block mb-1.5">Input File Path</label>
                <input value={inputPath} onChange={e => setInputPath(e.target.value)}
                  placeholder="/path/to/video.mp4 or /uploads/video.mp4"
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/50 transition-colors font-mono text-xs" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground block mb-1.5">Output Filename <span className="text-muted-foreground/50">(optional)</span></label>
                <input value={outputName} onChange={e => setOutputName(e.target.value)}
                  placeholder="output.mp4"
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/50 transition-colors" />
              </div>
              {selectedOp.fields.map(field => (
                <div key={field.key}>
                  <label className="text-[11px] font-medium text-muted-foreground block mb-1.5">{field.label}</label>
                  <input type="number" value={opOptions[field.key] ?? field.default}
                    onChange={e => setOpOptions(o => ({ ...o, [field.key]: e.target.value }))}
                    className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50 transition-colors" />
                </div>
              ))}
            </div>

            <AnimatePresence>
              {msg && (
                <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className={`text-xs px-3 py-2.5 rounded-xl border ${msg.type === "ok" ? "bg-green-500/8 text-green-400 border-green-500/20" : "bg-red-500/8 text-red-400 border-red-500/20"}`}>
                  {msg.text}
                </motion.p>
              )}
            </AnimatePresence>

            <button onClick={submit} disabled={submitting}
              className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r ${selectedOp.color} text-white text-sm font-semibold disabled:opacity-50 hover:opacity-90 transition-all active:scale-[0.98] shadow-md`}>
              {submitting ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
              {submitting ? "Starting job..." : `Run ${selectedOp.label}`}
            </button>
          </div>

          {/* Job history */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Clock size={13} className="text-muted-foreground" /> Job History
              </h3>
              <button onClick={loadJobs} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <RefreshCw size={12} />
              </button>
            </div>

            {loading ? (
              <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
            ) : jobs.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No jobs yet — submit a task above
              </div>
            ) : (
              <div className="space-y-2">
                {jobs.map(job => (
                  <motion.div key={job.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="bg-card border border-card-border rounded-xl px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold text-foreground capitalize">
                            {job.operation.replace(/_/g, " ")}
                          </span>
                          <StatusBadge status={job.status} />
                        </div>
                        <p className="text-[10px] font-mono text-muted-foreground truncate">{job.inputPath}</p>
                        {job.error && <p className="text-[10px] text-red-400 mt-0.5">{job.error}</p>}
                      </div>
                      <span className="text-[10px] text-muted-foreground/50 flex-shrink-0">
                        {new Date(job.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
