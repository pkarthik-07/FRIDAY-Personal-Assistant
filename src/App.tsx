import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, 
  MicOff, 
  Send, 
  Image as ImageIcon, 
  MessageSquare, 
  Settings, 
  X, 
  Loader2, 
  Volume2, 
  VolumeX,
  Plus,
  History,
  Info,
  Key,
  Radio,
  Activity,
  Calendar,
  ExternalLink,
  Search
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Markdown from 'react-markdown';
import { chatWithFriday, generateFridaySpeech, generateImage, connectLive } from './services/gemini';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  type?: 'text' | 'image';
  imageUrl?: string;
  sources?: { uri: string, title: string }[];
}

export default function App() {
  const [isListening, setIsListening] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: "Hello, I am FRIDAY. How can I assist you today?" }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'image' | 'live' | 'schedule'>('chat');
  const [imageSize, setImageSize] = useState<'1K' | '2K' | '4K'>('1K');
  const [isMuted, setIsMuted] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [schedule, setSchedule] = useState<{task: string, time: string}[]>([]);

  useEffect(() => {
    const savedSchedule = JSON.parse(localStorage.getItem('friday_schedule') || '[]');
    setSchedule(savedSchedule);
  }, [activeTab]);
  
  // Live State
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState<string[]>([]);
  const liveSessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    // Check for API key selection
    const checkApiKey = async () => {
      if (window.aistudio?.hasSelectedApiKey) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(hasKey);
      }
    };
    checkApiKey();
    
    const setupSpeechRecognition = () => {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) return;

      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        handleSendMessage(transcript);
        setIsListening(false);
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
        
        let errorMessage = "An error occurred with speech recognition. Please try again.";
        
        if (event.error === 'network') {
          errorMessage = "I'm having trouble connecting to the speech recognition service. Please check your internet connection and try again.";
          // Re-initialize on network error to ensure fresh state
          setTimeout(setupSpeechRecognition, 1000);
        } else if (event.error === 'not-allowed') {
          errorMessage = "Microphone access was denied. Please enable microphone permissions in your browser settings.";
        } else if (event.error === 'no-speech') {
          errorMessage = "I didn't hear anything. Please try speaking again.";
        } else if (event.error === 'aborted') {
          return;
        }

        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: errorMessage 
        }]);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    };

    setupSpeechRecognition();

    return () => {
      stopLiveSession();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, liveTranscript]);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      setIsListening(true);
      recognitionRef.current?.start();
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim()) return;

    const userMessage: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsProcessing(true);

    try {
      if (activeTab === 'chat') {
        const history = messages.map(m => ({ 
          role: m.role === 'user' ? 'user' : 'model', 
          parts: [{ text: m.content }] 
        }));
        const response = await chatWithFriday(text, history);
        
        // Extract grounding metadata (Search Results)
        const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
          ?.filter((chunk: any) => chunk.web)
          ?.map((chunk: any) => ({
            uri: chunk.web.uri,
            title: chunk.web.title
          }));

        // Handle Function Calls
        if (response.functionCalls) {
          for (const call of response.functionCalls) {
            if (call.name === 'openWebsite') {
              const { url, name } = call.args as { url: string, name: string };
              window.open(url, '_blank');
              const assistantMessage: Message = { 
                role: 'assistant', 
                content: `Certainly, Karthik. Opening ${name} for you now.` 
              };
              setMessages(prev => [...prev, assistantMessage]);
              
              if (!isMuted) {
                const audioBase64 = await generateFridaySpeech(`Opening ${name} for you now.`);
                if (audioBase64) {
                  const audio = new Audio(`data:audio/wav;base64,${audioBase64}`);
                  audio.play();
                }
              }
            } else if (call.name === 'scheduleTask') {
              const { task, time } = call.args as { task: string, time: string };
              const schedule = JSON.parse(localStorage.getItem('friday_schedule') || '[]');
              schedule.push({ task, time });
              localStorage.setItem('friday_schedule', JSON.stringify(schedule));
              setSchedule(schedule);
              
              const content = `Scheduled. I will remind you to ${task} at ${time}.`;
              const assistantMessage: Message = { role: 'assistant', content };
              setMessages(prev => [...prev, assistantMessage]);
              
              if (!isMuted) {
                const audioBase64 = await generateFridaySpeech(content);
                if (audioBase64) {
                  const audio = new Audio(`data:audio/wav;base64,${audioBase64}`);
                  audio.play();
                }
              }
            } else if (call.name === 'getSchedule') {
              const schedule = JSON.parse(localStorage.getItem('friday_schedule') || '[]');
              let content = "Your schedule today:";
              if (schedule.length === 0) {
                content = "You have no tasks scheduled for today, Karthik.";
              } else {
                content = schedule.map((s: any) => `- ${s.time} – ${s.task}`).join('\n');
              }
              
              const assistantMessage: Message = { role: 'assistant', content };
              setMessages(prev => [...prev, assistantMessage]);
              
              if (!isMuted) {
                const audioBase64 = await generateFridaySpeech(content);
                if (audioBase64) {
                  const audio = new Audio(`data:audio/wav;base64,${audioBase64}`);
                  audio.play();
                }
              }
            } else if (call.name === 'clearSchedule') {
              localStorage.removeItem('friday_schedule');
              setSchedule([]);
              const content = "I've cleared your schedule, Karthik.";
              const assistantMessage: Message = { role: 'assistant', content };
              setMessages(prev => [...prev, assistantMessage]);
              
              if (!isMuted) {
                const audioBase64 = await generateFridaySpeech(content);
                if (audioBase64) {
                  const audio = new Audio(`data:audio/wav;base64,${audioBase64}`);
                  audio.play();
                }
              }
            } else if (call.name === 'getRecentEmails') {
              const mockEmails = [
                { from: "Sri Indu College", subject: "Placement Drive Update", snippet: "The upcoming placement drive has been rescheduled to next Monday." },
                { from: "AI Research Lab", subject: "New Project Opportunity", snippet: "We are looking for B.Tech students interested in working on LLM optimization." },
                { from: "GitHub", subject: "Security Alert", snippet: "A new security vulnerability was found in one of your repositories." }
              ];
              const content = "Here are your recent emails, Karthik:\n" + mockEmails.map(e => `- **${e.from}**: ${e.subject} (${e.snippet})`).join('\n');
              const assistantMessage: Message = { role: 'assistant', content };
              setMessages(prev => [...prev, assistantMessage]);
              
              if (!isMuted) {
                const audioBase64 = await generateFridaySpeech("I've retrieved your recent emails. There's an update from Sri Indu College and a new project opportunity.");
                if (audioBase64) {
                  const audio = new Audio(`data:audio/wav;base64,${audioBase64}`);
                  audio.play();
                }
              }
            }
          }
        } else if (response.text) {
          const assistantMessage: Message = { 
            role: 'assistant', 
            content: response.text,
            sources: sources
          };
          setMessages(prev => [...prev, assistantMessage]);

          if (!isMuted) {
            const audioBase64 = await generateFridaySpeech(response.text);
            if (audioBase64) {
              const audio = new Audio(`data:audio/wav;base64,${audioBase64}`);
              audio.play();
            }
          }
        }
      } else if (activeTab === 'image') {
        // Image generation
        if (!hasApiKey) {
          await window.aistudio?.openSelectKey();
          setHasApiKey(true);
        }
        
        const imageUrl = await generateImage(text, imageSize);
        if (imageUrl) {
          const assistantMessage: Message = { 
            role: 'assistant', 
            content: `Generated image for: "${text}"`, 
            type: 'image',
            imageUrl 
          };
          setMessages(prev => [...prev, assistantMessage]);
        } else {
          throw new Error("Failed to generate image");
        }
      }
    } catch (error) {
      console.error('Error:', error);
      setMessages(prev => [...prev, { role: 'assistant', content: "I'm sorry, I encountered an error processing your request." }]);
    } finally {
      setIsProcessing(false);
    }
  };

  // Live Session Logic
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 3;

  const startLiveSession = async (isRetry = false) => {
    if (isLiveActive && !isRetry) return;
    
    if (!isRetry) {
      retryCountRef.current = 0;
    }

    try {
      setIsLiveActive(true);
      if (isRetry) {
        setLiveTranscript(prev => [...prev, `Attempting to reconnect (${retryCountRef.current}/${MAX_RETRIES})...`]);
      } else {
        setLiveTranscript(["Connecting to FRIDAY Live..."]);
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Cleanup existing context if any
      if (audioContextRef.current) {
        await audioContextRef.current.close();
      }
      
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      
      const source = audioContextRef.current.createMediaStreamSource(stream);
      processorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
      
      const sessionPromise = connectLive({
        onopen: () => {
          setLiveTranscript(prev => [...prev, "Connected. You can speak now."]);
          retryCountRef.current = 0; // Reset on success
          source.connect(processorRef.current!);
          processorRef.current!.connect(audioContextRef.current!.destination);
        },
        onmessage: (message) => {
          if (message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data) {
            const base64Audio = message.serverContent.modelTurn.parts[0].inlineData.data;
            playLiveAudio(base64Audio);
          }
          
          // Handle Function Calls in Live Mode
          if (message.toolCall) {
            for (const call of message.toolCall.functionCalls) {
              if (call.name === 'openWebsite') {
                const { url, name } = call.args as { url: string, name: string };
                window.open(url, '_blank');
                setLiveTranscript(prev => [...prev, `Opening ${name}...`]);
                
                // Send function response back to the model
                liveSessionRef.current?.sendToolResponse({
                  functionResponses: [{
                    name: 'openWebsite',
                    response: { result: `Successfully opened ${name}` },
                    id: call.id
                  }]
                });
              } else if (call.name === 'scheduleTask') {
                const { task, time } = call.args as { task: string, time: string };
                const schedule = JSON.parse(localStorage.getItem('friday_schedule') || '[]');
                schedule.push({ task, time });
                localStorage.setItem('friday_schedule', JSON.stringify(schedule));
                setSchedule(schedule);
                setLiveTranscript(prev => [...prev, `Scheduled: ${task} at ${time}`]);
                
                liveSessionRef.current?.sendToolResponse({
                  functionResponses: [{
                    name: 'scheduleTask',
                    response: { result: `Successfully scheduled ${task} at ${time}` },
                    id: call.id
                  }]
                });
              } else if (call.name === 'getSchedule') {
                const schedule = JSON.parse(localStorage.getItem('friday_schedule') || '[]');
                setLiveTranscript(prev => [...prev, `Retrieved schedule (${schedule.length} items)`]);
                
                liveSessionRef.current?.sendToolResponse({
                  functionResponses: [{
                    name: 'getSchedule',
                    response: { result: JSON.stringify(schedule) },
                    id: call.id
                  }]
                });
              } else if (call.name === 'clearSchedule') {
                localStorage.removeItem('friday_schedule');
                setSchedule([]);
                setLiveTranscript(prev => [...prev, "Cleared schedule"]);
                
                liveSessionRef.current?.sendToolResponse({
                  functionResponses: [{
                    name: 'clearSchedule',
                    response: { result: "Successfully cleared schedule" },
                    id: call.id
                  }]
                });
              } else if (call.name === 'getRecentEmails') {
                const mockEmails = [
                  { from: "Sri Indu College", subject: "Placement Drive Update", snippet: "The upcoming placement drive has been rescheduled to next Monday." },
                  { from: "AI Research Lab", subject: "New Project Opportunity", snippet: "We are looking for B.Tech students interested in working on LLM optimization." },
                  { from: "GitHub", subject: "Security Alert", snippet: "A new security vulnerability was found in one of your repositories." }
                ];
                setLiveTranscript(prev => [...prev, "Retrieved mock emails"]);
                
                liveSessionRef.current?.sendToolResponse({
                  functionResponses: [{
                    name: 'getRecentEmails',
                    response: { result: JSON.stringify(mockEmails) },
                    id: call.id
                  }]
                });
              }
            }
          }
          
          if (message.serverContent?.interrupted) {
            audioQueueRef.current = [];
            isPlayingRef.current = false;
          }
        },
        onerror: (err) => {
          console.error("Live session error:", err);
          const errorMessage = err?.message || String(err);
          
          if (errorMessage.includes("Internal error") || errorMessage.includes("unavailable")) {
            if (retryCountRef.current < MAX_RETRIES) {
              retryCountRef.current++;
              const delay = Math.pow(2, retryCountRef.current) * 1000;
              setLiveTranscript(prev => [...prev, "Service temporarily unavailable. Retrying in a few seconds..."]);
              setTimeout(() => startLiveSession(true), delay);
            } else {
              setLiveTranscript(prev => [...prev, "Connection failed after multiple attempts. Please try again later."]);
              stopLiveSession();
            }
          } else {
            setLiveTranscript(prev => [...prev, `Error: ${errorMessage}`]);
            stopLiveSession();
          }
        },
        onclose: () => {
          if (retryCountRef.current === 0) {
            stopLiveSession();
          }
        }
      });

      liveSessionRef.current = await sessionPromise;

      processorRef.current.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
        }
        
        const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
        liveSessionRef.current?.sendRealtimeInput({
          media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
        });
      };

    } catch (err) {
      console.error("Failed to start live session:", err);
      setLiveTranscript(prev => [...prev, "Failed to access microphone or connect."]);
      setIsLiveActive(false);
    }
  };

  const stopLiveSession = () => {
    setIsLiveActive(false);
    liveSessionRef.current?.close();
    liveSessionRef.current = null;
    
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    audioQueueRef.current = [];
    isPlayingRef.current = false;
  };

  const playLiveAudio = (base64: string) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    
    const pcmData = new Int16Array(bytes.buffer);
    const floatData = new Float32Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      floatData[i] = pcmData[i] / 0x7FFF;
    }
    
    audioQueueRef.current.push(floatData);
    if (!isPlayingRef.current) {
      processAudioQueue();
    }
  };

  const processAudioQueue = async () => {
    if (audioQueueRef.current.length === 0 || !audioContextRef.current) {
      isPlayingRef.current = false;
      return;
    }

    isPlayingRef.current = true;
    const data = audioQueueRef.current.shift()!;
    const buffer = audioContextRef.current.createBuffer(1, data.length, 24000);
    buffer.getChannelData(0).set(data);
    
    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);
    source.onended = () => processAudioQueue();
    source.start();
  };

  const openKeyDialog = async () => {
    await window.aistudio?.openSelectKey();
    setHasApiKey(true);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e0e0e0] font-sans selection:bg-emerald-500/30">
      {/* Sidebar / Navigation */}
      <div className="fixed left-0 top-0 bottom-0 w-16 bg-[#121212] border-r border-white/5 flex flex-col items-center py-8 gap-8 z-50">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 overflow-hidden">
          <img 
            src="https://cdn.pixabay.com/photo/2023/03/05/18/45/ai-generated-7832043_1280.png" 
            alt="FRIDAY Logo" 
            className="w-full h-full object-cover animate-[pulse_6s_infinite] scale-125"
            referrerPolicy="no-referrer"
          />
        </div>
        
        <nav className="flex flex-col gap-4">
          <button 
            onClick={() => setActiveTab('chat')}
            className={cn(
              "p-3 rounded-xl transition-all duration-200",
              activeTab === 'chat' ? "bg-emerald-500/10 text-emerald-500" : "text-white/40 hover:text-white/60"
            )}
          >
            <MessageSquare size={20} />
          </button>
          <button 
            onClick={() => setActiveTab('image')}
            className={cn(
              "p-3 rounded-xl transition-all duration-200",
              activeTab === 'image' ? "bg-emerald-500/10 text-emerald-500" : "text-white/40 hover:text-white/60"
            )}
          >
            <ImageIcon size={20} />
          </button>
          <button 
            onClick={() => setActiveTab('live')}
            className={cn(
              "p-3 rounded-xl transition-all duration-200",
              activeTab === 'live' ? "bg-emerald-500/10 text-emerald-500" : "text-white/40 hover:text-white/60"
            )}
            title="Live Mode"
          >
            <Radio size={20} />
          </button>
          <button 
            onClick={() => setActiveTab('schedule')}
            className={cn(
              "p-3 rounded-xl transition-all duration-200",
              activeTab === 'schedule' ? "bg-emerald-500/10 text-emerald-500" : "text-white/40 hover:text-white/60"
            )}
            title="Schedule"
          >
            <Calendar size={20} />
          </button>
        </nav>

        <div className="mt-auto flex flex-col gap-4">
          <button 
            onClick={openKeyDialog}
            className={cn(
              "p-3 rounded-xl transition-all duration-200",
              hasApiKey ? "text-emerald-500" : "text-white/40 hover:text-white/60"
            )}
            title="API Key Settings"
          >
            <Key size={20} />
          </button>
          <button 
            onClick={() => setIsMuted(!isMuted)}
            className="p-3 rounded-xl text-white/40 hover:text-white/60 transition-all duration-200"
          >
            {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="pl-16 h-screen flex flex-col">
        {/* Header */}
        <header className="h-16 border-bottom border-white/5 flex items-center justify-between px-8 bg-[#0a0a0a]/80 backdrop-blur-md sticky top-0 z-40">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 overflow-hidden">
              <img 
                src="https://cdn.pixabay.com/photo/2023/03/05/18/45/ai-generated-7832043_1280.png" 
                alt="FRIDAY" 
                className="w-full h-full object-cover scale-125"
                referrerPolicy="no-referrer"
              />
            </div>
            <h1 className="text-lg font-medium tracking-tight">FRIDAY</h1>
            <span className="text-[10px] uppercase tracking-[0.2em] text-white/30 font-mono">
              {activeTab === 'live' ? 'Live Session' : 'Personal Assistant'}
            </span>
          </div>
          
          {activeTab === 'image' && (
            <div className="flex items-center gap-2 bg-white/5 p-1 rounded-lg border border-white/10">
              {(['1K', '2K', '4K'] as const).map((size) => (
                <button
                  key={size}
                  onClick={() => setImageSize(size)}
                  className={cn(
                    "px-3 py-1 text-[10px] font-mono rounded transition-all",
                    imageSize === size ? "bg-emerald-500 text-black font-bold" : "text-white/40 hover:text-white/60"
                  )}
                >
                  {size}
                </button>
              ))}
            </div>
          )}
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-8 space-y-8 scrollbar-hide">
          {activeTab === 'live' ? (
            <div className="h-full flex flex-col items-center justify-center space-y-12">
              <div className="relative">
                <div className={cn(
                  "w-48 h-48 rounded-full border-2 border-emerald-500/20 flex items-center justify-center transition-all duration-500",
                  isLiveActive ? "scale-110 border-emerald-500/50 shadow-[0_0_50px_rgba(16,185,129,0.2)]" : "scale-100"
                )}>
                  <div className={cn(
                    "w-32 h-32 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 overflow-hidden",
                    isLiveActive && "animate-pulse"
                  )}>
                    <img 
                      src="https://cdn.pixabay.com/photo/2023/03/05/18/45/ai-generated-7832043_1280.png" 
                      alt="Neural Core" 
                      className={cn(
                        "w-full h-full object-cover transition-all duration-500 scale-125",
                        isLiveActive ? "opacity-100 scale-150" : "opacity-40 scale-125 grayscale"
                      )}
                      referrerPolicy="no-referrer"
                    />
                  </div>
                </div>
                {isLiveActive && (
                  <div className="absolute -inset-4 border border-emerald-500/10 rounded-full animate-[ping_3s_infinite]" />
                )}
              </div>

              <div className="text-center space-y-4 max-w-md">
                <h2 className="text-2xl font-light tracking-tight">
                  {isLiveActive ? "FRIDAY is Listening" : "Start Live Session"}
                </h2>
                <p className="text-sm text-white/40 leading-relaxed">
                  {isLiveActive 
                    ? "Speak naturally. FRIDAY will respond in real-time with low latency." 
                    : "Experience a seamless, real-time voice conversation with FRIDAY."}
                </p>
              </div>

              <button
                onClick={() => isLiveActive ? stopLiveSession() : startLiveSession()}
                className={cn(
                  "px-8 py-3 rounded-2xl font-medium transition-all duration-300 flex items-center gap-3",
                  isLiveActive 
                    ? "bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20" 
                    : "bg-emerald-500 text-black hover:bg-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.3)]"
                )}
              >
                {isLiveActive ? (
                  <>
                    <MicOff size={20} />
                    <span>End Session</span>
                  </>
                ) : (
                  <>
                    <Mic size={20} />
                    <span>Start Conversation</span>
                  </>
                )}
              </button>

              <div className="w-full max-w-lg bg-white/5 rounded-2xl p-4 border border-white/10 min-h-[100px] max-h-[200px] overflow-y-auto">
                <div className="text-[10px] uppercase tracking-widest text-white/20 mb-2 font-mono">Session Status</div>
                {liveTranscript.map((t, i) => (
                  <div key={i} className="text-xs text-white/60 mb-1 font-mono">{t}</div>
                ))}
              </div>
            </div>
          ) : activeTab === 'schedule' ? (
            <div className="max-w-3xl mx-auto space-y-8">
              <div className="flex items-baseline justify-between">
                <h2 className="text-3xl font-light tracking-tight">Your Schedule</h2>
                <span className="text-xs font-mono text-white/30 uppercase tracking-widest">
                  {schedule.length} Tasks Total
                </span>
              </div>
              
              <div className="grid gap-4">
                {schedule.length === 0 ? (
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-12 text-center space-y-4">
                    <Calendar size={48} className="mx-auto text-white/10" />
                    <p className="text-white/40">No tasks scheduled for today, Karthik.</p>
                    <button 
                      onClick={() => setActiveTab('chat')}
                      className="text-emerald-500 text-sm hover:underline"
                    >
                      Schedule something in Chat
                    </button>
                  </div>
                ) : (
                  schedule.map((item, idx) => (
                    <motion.div 
                      key={idx}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      className="bg-white/5 border border-white/10 rounded-2xl p-6 flex items-center justify-between group hover:bg-white/[0.07] transition-all"
                    >
                      <div className="space-y-1">
                        <h3 className="text-lg font-medium text-white/90">{item.task}</h3>
                        <p className="text-sm text-white/40 font-mono uppercase tracking-wider">{item.time}</p>
                      </div>
                      <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Activity size={18} />
                      </div>
                    </motion.div>
                  ))
                )}
              </div>

              {schedule.length > 0 && (
                <button 
                  onClick={() => {
                    localStorage.removeItem('friday_schedule');
                    setSchedule([]);
                  }}
                  className="text-xs text-red-500/60 hover:text-red-500 font-mono uppercase tracking-widest transition-colors"
                >
                  Clear All Tasks
                </button>
              )}
            </div>
          ) : (
            <>
              <AnimatePresence initial={false}>
                {messages.map((msg, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "flex flex-col max-w-2xl",
                      msg.role === 'user' ? "ml-auto items-end" : "items-start"
                    )}
                  >
                    <div className={cn(
                      "px-4 py-3 rounded-2xl text-sm leading-relaxed",
                      msg.role === 'user' 
                        ? "bg-emerald-500/10 text-emerald-50 text-right border border-emerald-500/20" 
                        : "bg-white/5 text-white/80 border border-white/10"
                    )}>
                      {msg.type === 'image' ? (
                        <div className="space-y-3">
                          <p className="text-xs text-white/40 italic">{msg.content}</p>
                          <img 
                            src={msg.imageUrl} 
                            alt="Generated" 
                            className="rounded-xl w-full aspect-square object-cover border border-white/10"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      ) : (
                        <div className="markdown-body prose prose-invert prose-sm max-w-none">
                          <Markdown>{msg.content}</Markdown>
                        </div>
                      )}
                      
                      {msg.sources && msg.sources.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-white/5 space-y-2">
                          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/30 font-mono">
                            <Search size={10} />
                            <span>Sources</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {msg.sources.map((source, sIdx) => (
                              <a
                                key={sIdx}
                                href={source.uri}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/5 border border-white/5 text-[10px] text-emerald-500/80 hover:bg-white/10 hover:text-emerald-400 transition-all"
                              >
                                <span className="truncate max-w-[150px]">{source.title}</span>
                                <ExternalLink size={8} />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] uppercase tracking-widest text-white/20 mt-2 font-mono">
                      {msg.role === 'user' ? 'User' : 'FRIDAY'}
                    </span>
                  </motion.div>
                ))}
              </AnimatePresence>
              {isProcessing && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center gap-2 text-white/30 text-xs font-mono"
                >
                  <Loader2 size={14} className="animate-spin" />
                  <span>FRIDAY is thinking...</span>
                </motion.div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        {activeTab !== 'live' && (
          <div className="p-8 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a] to-transparent">
            <div className="max-w-3xl mx-auto relative group">
              <div className="absolute -inset-0.5 bg-emerald-500/20 rounded-2xl blur opacity-0 group-focus-within:opacity-100 transition duration-500" />
              <div className="relative flex items-center gap-4 bg-[#121212] border border-white/10 rounded-2xl p-2 pl-4">
                <div className="flex items-center gap-2 px-2 border-r border-white/5 text-emerald-500/50" title="Google Search Enabled">
                  <Search size={16} />
                </div>
                <input 
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage(inputValue)}
                  placeholder={activeTab === 'chat' ? "Ask FRIDAY anything..." : "Describe the image to generate..."}
                  className="flex-1 bg-transparent border-none focus:ring-0 text-sm placeholder:text-white/20"
                />
                
                <div className="flex items-center gap-2 pr-2">
                  <button 
                    onClick={toggleListening}
                    className={cn(
                      "p-2.5 rounded-xl transition-all duration-300",
                      isListening 
                        ? "bg-red-500/20 text-red-500 animate-pulse" 
                        : "bg-white/5 text-white/40 hover:text-white/60"
                    )}
                  >
                    {isListening ? <MicOff size={18} /> : <Mic size={18} />}
                  </button>
                  
                  <button 
                    onClick={() => handleSendMessage(inputValue)}
                    disabled={isProcessing || !inputValue.trim()}
                    className="p-2.5 rounded-xl bg-emerald-500 text-black hover:bg-emerald-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send size={18} />
                  </button>
                </div>
              </div>
            </div>
            <p className="text-center text-[10px] text-white/20 mt-4 font-mono uppercase tracking-widest">
              {activeTab === 'chat' ? 'Voice & Text Assistant' : 'AI Image Generation'}
            </p>
          </div>
        )}
      </main>

      {/* Visualizer Overlay (Optional) */}
      {isListening && (
        <div className="fixed inset-0 pointer-events-none z-0 flex items-center justify-center overflow-hidden">
          <div className="w-[800px] h-[800px] bg-emerald-500/5 rounded-full blur-[120px] animate-pulse" />
          <div className="absolute w-[400px] h-[400px] border border-emerald-500/10 rounded-full animate-[ping_3s_infinite]" />
        </div>
      )}
    </div>
  );
}
