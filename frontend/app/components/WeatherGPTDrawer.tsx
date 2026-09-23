"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, Send, Bot, User, MessageSquare } from "lucide-react";
import { ChatMessage } from "../types/weather";

interface WeatherGPTDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  loading: boolean;
  currentLocation?: string | null;
}

const SAMPLE_PROMPTS = [
  "What should I wear today?",
  "Will it rain later in the evening?",
  "Is the weather suitable for outdoor sports?",
  "Give me a quick 3-day climate summary.",
];

export function WeatherGPTDrawer({
  isOpen,
  onClose,
  messages,
  onSendMessage,
  loading,
  currentLocation,
}: WeatherGPTDrawerProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // Body scroll lock & focus management
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      document.body.style.overflow = "hidden";
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      document.body.style.overflow = "";
      previousActiveElement.current?.focus?.();
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !loading) {
      onSendMessage(input.trim());
      setInput("");
    }
  };

  const handlePromptClick = (prompt: string) => {
    if (!loading) {
      onSendMessage(prompt);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden="true"
            className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm"
          />

          {/* Sliding Drawer Dialog Container */}
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="weathergpt-drawer-title"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed top-0 right-0 z-50 h-full w-full max-w-md bg-slate-900/95 border-l border-slate-800 shadow-2xl flex flex-col backdrop-blur-xl"
          >
            {/* Drawer Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 shadow-md shadow-sky-500/20">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3
                    id="weathergpt-drawer-title"
                    className="text-base font-bold text-white flex items-center gap-2"
                  >
                    WeatherGPT
                    {currentLocation && (
                      <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-slate-800 text-sky-400 border border-slate-700">
                        {currentLocation}
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-400">AI Climate & Forecast Assistant</p>
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="Close WeatherGPT drawer"
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Messages Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center px-4 space-y-4 my-8">
                  <div className="p-4 rounded-3xl bg-sky-500/10 border border-sky-500/20 text-sky-400">
                    <MessageSquare className="w-10 h-10 animate-bounce" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-white">Ask WeatherGPT Anything</h4>
                    <p className="text-xs text-slate-400 leading-relaxed max-w-xs">
                      Get instant AI insights about temperature, clothing suggestions, rain timing, and trip recommendations.
                    </p>
                  </div>

                  {/* Sample prompt chips */}
                  <div className="w-full space-y-2 pt-4">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block text-left">
                      Suggested Questions:
                    </span>
                    {SAMPLE_PROMPTS.map((prompt, idx) => (
                      <button
                        key={idx}
                        onClick={() => handlePromptClick(prompt)}
                        className="w-full text-left p-3 rounded-2xl glass-panel-interactive text-xs text-slate-300 hover:text-sky-300 font-medium transition-all"
                      >
                        ⚡ "{prompt}"
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex items-start gap-3 ${
                      msg.role === "user" ? "flex-row-reverse" : ""
                    }`}
                  >
                    <div
                      className={`p-2 rounded-xl text-xs shrink-0 ${
                        msg.role === "user"
                          ? "bg-sky-500 text-white"
                          : "bg-slate-800 text-sky-400 border border-slate-700"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <User className="w-4 h-4" />
                      ) : (
                        <Bot className="w-4 h-4" />
                      )}
                    </div>

                    <div
                      className={`p-3.5 rounded-2xl text-xs leading-relaxed max-w-[82%] ${
                        msg.role === "user"
                          ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-md shadow-sky-500/10"
                          : "bg-slate-800/80 border border-slate-700/60 text-slate-200"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </motion.div>
                ))
              )}

              {loading && (
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-slate-800 text-sky-400 border border-slate-700">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div className="p-3.5 rounded-2xl bg-slate-800/80 border border-slate-700/60 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-sky-400 animate-bounce" />
                    <span className="w-2 h-2 rounded-full bg-sky-400 animate-bounce [animation-delay:0.2s]" />
                    <span className="w-2 h-2 rounded-full bg-sky-400 animate-bounce [animation-delay:0.4s]" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Drawer Input */}
            <form onSubmit={handleSubmit} className="p-4 border-t border-slate-800 bg-slate-900/90">
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  aria-label="Ask WeatherGPT a question"
                  placeholder="Ask a question..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="flex-1 glass-input rounded-2xl px-4 py-2.5 text-xs text-white placeholder-slate-400 focus:outline-none"
                />
                <button
                  type="submit"
                  aria-label="Send message"
                  disabled={loading || !input.trim()}
                  className="p-2.5 rounded-2xl bg-sky-500 hover:bg-sky-400 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md shadow-sky-500/20"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </form>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
