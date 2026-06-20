import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Download, Loader2, Image as ImageIcon, Wand2, X, ZoomIn, RefreshCw } from "lucide-react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

interface GeneratedImage {
  id: number;
  prompt: string;
  url: string;
  width: number;
  height: number;
  model: string;
  createdAt: string;
}

const MODELS = [
  { id: "flux", label: "FLUX", badge: "Best" },
  { id: "flux-realism", label: "FLUX Realism", badge: "Photo" },
  { id: "flux-anime", label: "FLUX Anime", badge: "Art" },
  { id: "turbo", label: "Turbo", badge: "Fast" },
];

const SIZES = [
  { label: "Square", w: 1024, h: 1024, icon: "⬛" },
  { label: "Landscape", w: 1280, h: 720, icon: "▬" },
  { label: "Portrait", w: 720, h: 1280, icon: "▮" },
  { label: "Wide", w: 1920, h: 1080, icon: "▭" },
];

const STYLE_PRESETS = [
  "photorealistic", "cinematic", "oil painting", "watercolor",
  "anime", "digital art", "sketch", "3D render", "neon", "vintage"
];

const PROMPT_IDEAS = [
  "A futuristic city at sunset with flying cars",
  "Portrait of a samurai warrior in cherry blossom forest",
  "Deep ocean bioluminescent creatures",
  "Cozy coffee shop interior on a rainy day",
];

export default function ImagesPage() {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("flux");
  const [size, setSize] = useState(SIZES[0]!);
  const [negPrompt, setNegPrompt] = useState("");
  const [seed, setSeed] = useState("");
  const [generating, setGenerating] = useState(false);
  const [gallery, setGallery] = useState<GeneratedImage[]>([]);
  const [lightbox, setLightbox] = useState<GeneratedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);

  const loadGallery = async () => {
    const r = await fetch(`${API}/api/images/gallery`);
    const d = await r.json();
    setGallery(d.images || []);
  };

  useEffect(() => { loadGallery(); }, []);

  const generate = async () => {
    if (!prompt.trim() || generating) return;
    setError(null);
    setGenerating(true);
    try {
      const fullPrompt = selectedStyle ? `${prompt.trim()}, ${selectedStyle} style` : prompt.trim();
      const r = await fetch(`${API}/api/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: fullPrompt, model, width: size.w, height: size.h, negativePrompt: negPrompt || undefined, seed: seed ? parseInt(seed) : undefined }),
      });
      const d = await r.json();
      if (d.error) { setError(d.error); return; }
      await loadGallery();
    } catch (_) { setError("Generation failed. Please try again."); }
    finally { setGenerating(false); }
  };

  const deleteImage = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`${API}/api/images/${id}`, { method: "DELETE" });
    setGallery(g => g.filter(img => img.id !== id));
  };

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      {/* Lightbox */}
      <AnimatePresence>
        {lightbox && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setLightbox(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
            <button onClick={() => setLightbox(null)}
              className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors">
              <X size={18} />
            </button>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              onClick={e => e.stopPropagation()}
              className="max-w-4xl w-full space-y-3">
              <img src={lightbox.url} alt={lightbox.prompt} className="w-full rounded-2xl shadow-2xl" />
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm text-white/80 flex-1">{lightbox.prompt}</p>
                <a href={lightbox.url} download target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 text-white text-xs hover:bg-white/20 transition-colors flex-shrink-0">
                  <Download size={12} /> Download
                </a>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Generation panel */}
      <div className="border-b border-border/50 bg-card/30 flex-shrink-0">
        <div className="max-w-4xl mx-auto px-4 py-4 space-y-3">
          {/* Main prompt */}
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generate(); } }}
                placeholder="Describe your image... (e.g., 'A cinematic shot of a lone astronaut on Mars at dusk')"
                rows={2}
                className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder-muted-foreground resize-none outline-none focus:border-primary/50 focus:shadow-[0_0_0_1px_hsl(var(--primary)/0.2)] transition-all pr-10"
              />
              <Wand2 size={14} className="absolute right-3 top-3.5 text-muted-foreground/40" />
            </div>
            <button onClick={generate} disabled={generating || !prompt.trim()}
              className="px-5 py-2 rounded-xl bg-primary text-white font-medium text-sm disabled:opacity-40 hover:bg-primary/85 transition-all active:scale-95 shadow-lg flex items-center gap-2 self-start flex-shrink-0">
              {generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {generating ? "Creating..." : "Generate"}
            </button>
          </div>

          {/* Style presets */}
          <div className="flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-none">
            <span className="text-[10px] text-muted-foreground flex-shrink-0">Style:</span>
            {STYLE_PRESETS.map(style => (
              <button key={style} onClick={() => setSelectedStyle(selectedStyle === style ? null : style)}
                className={`flex-shrink-0 px-2.5 py-1 rounded-full text-[10px] font-medium transition-all border
                  ${selectedStyle === style ? "bg-primary/15 text-primary border-primary/30" : "bg-muted/50 text-muted-foreground border-border/40 hover:border-primary/20 hover:text-foreground"}`}>
                {style}
              </button>
            ))}
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Model */}
            <div className="flex items-center gap-1.5 bg-muted/40 rounded-xl p-1 border border-border/40">
              {MODELS.map(m => (
                <button key={m.id} onClick={() => setModel(m.id)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-all
                    ${model === m.id ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                  {m.label}
                </button>
              ))}
            </div>

            {/* Size */}
            <div className="flex items-center gap-1.5 bg-muted/40 rounded-xl p-1 border border-border/40">
              {SIZES.map(s => (
                <button key={s.label} onClick={() => setSize(s)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all
                    ${size.label === s.label ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  title={`${s.w}×${s.h}`}>
                  {s.icon} {s.label}
                </button>
              ))}
            </div>

            <button onClick={() => setShowAdvanced(!showAdvanced)}
              className="ml-auto text-[11px] text-muted-foreground hover:text-foreground transition-colors">
              {showAdvanced ? "Hide" : "Advanced"} ▾
            </button>
          </div>

          {/* Advanced options */}
          <AnimatePresence>
            {showAdvanced && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">Negative Prompt</label>
                    <input value={negPrompt} onChange={e => setNegPrompt(e.target.value)}
                      placeholder="blur, ugly, distorted..."
                      className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/40 transition-colors" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">Seed (optional)</label>
                    <input value={seed} onChange={e => setSeed(e.target.value)} type="number"
                      placeholder="Random"
                      className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/40 transition-colors" />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {error && <p className="text-xs text-red-400 bg-red-400/8 rounded-lg px-3 py-2">{error}</p>}

          {/* Prompt ideas */}
          {!prompt && (
            <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
              <span className="text-[10px] text-muted-foreground flex-shrink-0">Try:</span>
              {PROMPT_IDEAS.map(idea => (
                <button key={idea} onClick={() => setPrompt(idea)}
                  className="flex-shrink-0 px-2.5 py-1 rounded-full text-[10px] bg-muted/50 text-muted-foreground border border-border/30 hover:border-primary/30 hover:text-foreground transition-colors">
                  {idea.slice(0, 35)}...
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Gallery */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-6xl mx-auto">
          {generating && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl bg-primary/8 border border-primary/20 text-primary text-sm">
              <Loader2 size={16} className="animate-spin" />
              <span>Generating your image with {MODELS.find(m => m.id === model)?.label}...</span>
            </motion.div>
          )}

          {gallery.length === 0 && !generating ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-2xl bg-muted/40 flex items-center justify-center mb-4">
                <ImageIcon size={24} className="text-muted-foreground/30" />
              </div>
              <p className="text-sm text-muted-foreground mb-1">Your gallery is empty</p>
              <p className="text-xs text-muted-foreground/50">Generate your first image above</p>
            </div>
          ) : (
            <div className="columns-2 sm:columns-3 lg:columns-4 gap-3 space-y-3">
              {gallery.map((img, i) => (
                <motion.div key={img.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="group relative break-inside-avoid rounded-xl overflow-hidden cursor-pointer bg-muted/30 border border-border/40 hover:border-primary/30 transition-all"
                  onClick={() => setLightbox(img)}>
                  <img src={img.url} alt={img.prompt} className="w-full object-cover block" loading="lazy" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="absolute bottom-0 left-0 right-0 p-3 space-y-2">
                      <p className="text-white text-[10px] leading-relaxed line-clamp-2">{img.prompt}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-white/60 px-1.5 py-0.5 rounded bg-white/10">{img.model}</span>
                        <span className="text-[9px] text-white/40 ml-auto">{img.width}×{img.height}</span>
                      </div>
                    </div>
                    <div className="absolute top-2 right-2 flex gap-1.5">
                      <a href={img.url} download target="_blank" rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="p-1.5 rounded-lg bg-black/50 text-white hover:bg-black/70 transition-colors">
                        <Download size={12} />
                      </a>
                      <button onClick={e => deleteImage(img.id, e)}
                        className="p-1.5 rounded-lg bg-black/50 text-white hover:bg-red-500/70 transition-colors">
                        <X size={12} />
                      </button>
                    </div>
                    <div className="absolute top-2 left-2">
                      <ZoomIn size={12} className="text-white/60" />
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
