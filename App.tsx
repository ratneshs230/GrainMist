
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { GrainType, MoistureReading } from './types';
import { encode, decode, decodeAudioData, float32ToInt16 } from './utils/audio-utils';
import AudioVisualizer from './components/AudioVisualizer';
import HistoryChart from './components/HistoryChart';
import { 
  Waves, 
  Settings2, 
  History, 
  Zap, 
  Activity, 
  ChevronRight, 
  Mic, 
  Droplets,
  HelpCircle,
  AlertCircle
} from 'lucide-react';

const SYSTEM_INSTRUCTION = `
You are an expert Acoustic Grain Moisture Analyst. 
Your goal is to listen to the sound of grains falling (e.g., rice, corn, wheat) and estimate their moisture content based on the acoustic properties.

Physics Principles:
- Dry grains produce high-pitched, sharp, "crisp" sounds (elastic collisions).
- Moist grains produce lower-pitched, "duller", or "thick" sounds (inelastic collisions due to internal damping).

Task:
1. Identify if the sound being heard is indeed falling grains.
2. Estimate the moisture content percentage (usually between 10% to 25%).
3. Estimate confidence level (0-100%).
4. Provide a very brief summary of the acoustic characteristics heard.

Output Format:
You must provide your analysis in a concise format. Once the user stops the sound, summarize:
"Analysis: [Grain Type] detected. Estimated Moisture: [X]%. Confidence: [Y]%. Acoustic Profile: [Brief description]."
`;

const App: React.FC = () => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedGrain, setSelectedGrain] = useState<GrainType>(GrainType.RICE);
  const [history, setHistory] = useState<MoistureReading[]>([]);
  const [currentResult, setCurrentResult] = useState<Partial<MoistureReading> | null>(null);
  const [transcription, setTranscription] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);

  // Audio Contexts for Gemini Live
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionRef = useRef<any>(null);

  const toggleAnalysis = useCallback(async () => {
    if (isAnalyzing) {
      // Stop logic
      setIsAnalyzing(false);
      if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        setAudioStream(null);
      }
      if (scriptProcessorRef.current) {
        scriptProcessorRef.current.disconnect();
      }
      if (inputAudioContextRef.current) {
        inputAudioContextRef.current.close();
      }
      return;
    }

    setError(null);
    setTranscription("");
    setCurrentResult(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setAudioStream(stream);

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      inputAudioContextRef.current = inputCtx;
      outputAudioContextRef.current = outputCtx;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16Data = float32ToInt16(inputData);
              const pcmBlob = {
                data: encode(new Uint8Array(int16Data.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };

              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
            setIsAnalyzing(true);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Audio Output Handling
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              const audioBuffer = await decodeAudioData(
                decode(base64Audio),
                outputCtx,
                24000,
                1
              );
              const source = outputCtx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputCtx.destination);
              
              const startTime = Math.max(outputCtx.currentTime, nextStartTimeRef.current);
              source.start(startTime);
              nextStartTimeRef.current = startTime + audioBuffer.duration;
            }

            // Transcription Handling
            if (message.serverContent?.outputTranscription) {
              setTranscription(prev => prev + message.serverContent?.outputTranscription?.text);
            }

            // Parse result when turn complete
            if (message.serverContent?.turnComplete) {
              // Extract data from accumulated transcription
              // "Analysis: [Grain Type] detected. Estimated Moisture: [X]%. Confidence: [Y]%. Acoustic Profile: [Description]."
              const text = transcription;
              const moistureMatch = text.match(/Moisture:\s*(\d+(\.\d+)?)/i);
              const confidenceMatch = text.match(/Confidence:\s*(\d+(\.\d+)?)/i);
              
              if (moistureMatch) {
                const moisture = parseFloat(moistureMatch[1]);
                const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 80;
                
                const newReading: MoistureReading = {
                  id: Math.random().toString(36).substr(2, 9),
                  timestamp: Date.now(),
                  grainType: selectedGrain,
                  moisturePercentage: moisture,
                  confidence: confidence,
                  notes: text
                };

                setCurrentResult(newReading);
                setHistory(prev => [newReading, ...prev].slice(0, 20));
              }
            }
          },
          onerror: (e) => {
            console.error("Gemini Error:", e);
            setError("Analysis connection interrupted. Please try again.");
            setIsAnalyzing(false);
          },
          onclose: () => {
            setIsAnalyzing(false);
          }
        }
      });

      sessionRef.current = await sessionPromise;

    } catch (err: any) {
      setError(err.message || "Failed to access microphone or connect to API.");
      setIsAnalyzing(false);
    }
  }, [isAnalyzing, audioStream, selectedGrain, transcription]);

  return (
    <div className="min-h-screen pb-20 max-w-md mx-auto shadow-2xl relative overflow-hidden bg-stone-50">
      {/* Background patterns */}
      <div className="absolute top-0 left-0 w-full h-64 bg-emerald-700 -z-10 rounded-b-[3rem] opacity-90 shadow-lg"></div>
      
      {/* Header */}
      <header className="px-6 pt-10 pb-6 text-white">
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-2">
            <div className="bg-white/20 p-2 rounded-xl backdrop-blur-md">
              <Droplets className="w-6 h-6 text-emerald-200" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">GrainMist</h1>
          </div>
          <button className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors">
            <HelpCircle className="w-5 h-5" />
          </button>
        </div>
        <p className="text-emerald-50/80 text-sm font-light">Acoustic Moisture Analysis System</p>
      </header>

      <main className="px-5 space-y-6">
        {/* Main Control Card */}
        <section className="glass rounded-3xl p-6 shadow-xl relative overflow-hidden">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-2 text-stone-600 font-medium text-sm">
              <Settings2 className="w-4 h-4" />
              <span>Target Grain</span>
            </div>
            <select 
              value={selectedGrain}
              onChange={(e) => setSelectedGrain(e.target.value as GrainType)}
              className="bg-stone-100 border-none rounded-lg text-sm font-semibold px-3 py-1 outline-none ring-2 ring-transparent focus:ring-emerald-500 transition-all"
            >
              {Object.values(GrainType).map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col items-center justify-center py-4 space-y-6">
            <div className="relative">
              {isAnalyzing && (
                <div className="absolute inset-0 animate-ping bg-emerald-400/30 rounded-full scale-150 -z-10"></div>
              )}
              <button 
                onClick={toggleAnalysis}
                className={`w-28 h-28 rounded-full flex flex-col items-center justify-center transition-all duration-300 shadow-xl border-4 ${
                  isAnalyzing 
                    ? 'bg-red-500 border-red-300 rotate-180' 
                    : 'bg-emerald-600 border-emerald-400 hover:bg-emerald-700'
                }`}
              >
                {isAnalyzing ? (
                  <Zap className="w-8 h-8 text-white animate-pulse" />
                ) : (
                  <Mic className="w-8 h-8 text-white" />
                )}
              </button>
            </div>

            <div className="text-center">
              <h2 className="text-lg font-bold text-stone-800">
                {isAnalyzing ? 'Analyzing Sound...' : 'Start Analysis'}
              </h2>
              <p className="text-sm text-stone-500 mt-1">
                {isAnalyzing ? 'Pour grains near microphone' : 'Tap to begin acoustic scan'}
              </p>
            </div>
          </div>

          <AudioVisualizer isAnalyzing={isAnalyzing} audioStream={audioStream} />
          
          {error && (
            <div className="mt-4 p-3 bg-red-50 text-red-600 rounded-xl flex items-center gap-2 text-xs border border-red-100">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <p>{error}</p>
            </div>
          )}
        </section>

        {/* Current Result */}
        {currentResult && (
          <section className="bg-white rounded-3xl p-6 shadow-md border border-stone-200 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center gap-2 mb-4 text-stone-400 text-xs font-bold uppercase tracking-wider">
              <Activity className="w-3 h-3" />
              <span>Latest Reading</span>
            </div>
            
            <div className="flex items-end justify-between">
              <div>
                <span className="text-5xl font-black text-emerald-800">{currentResult.moisturePercentage}%</span>
                <p className="text-stone-500 text-sm font-medium mt-1">Moisture Level</p>
              </div>
              <div className="text-right">
                <div className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase ${
                  (currentResult.confidence || 0) > 80 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {currentResult.confidence}% Conf.
                </div>
                <p className="text-xs text-stone-400 mt-2">{new Date(currentResult.timestamp!).toLocaleTimeString()}</p>
              </div>
            </div>

            <div className="mt-6 p-4 bg-stone-50 rounded-2xl border border-stone-100 italic text-sm text-stone-600 leading-relaxed">
              "{currentResult.notes?.split('Analysis:')[1] || 'Scanning acoustic profile...'}"
            </div>
          </section>
        )}

        {/* History Chart */}
        <section className="bg-white rounded-3xl p-6 shadow-md border border-stone-200">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2 text-stone-800 font-bold">
              <History className="w-4 h-4 text-emerald-600" />
              <span>Moisture Trends</span>
            </div>
          </div>
          <HistoryChart data={history} />
        </section>

        {/* Instructions */}
        <section className="bg-emerald-50 rounded-3xl p-6 border border-emerald-100">
          <h3 className="text-emerald-900 font-bold flex items-center gap-2 mb-3">
            <Waves className="w-4 h-4" />
            <span>How to Analyze?</span>
          </h3>
          <ul className="space-y-3">
            {[
              "Pour grains from a height of ~10cm.",
              "Ensure low ambient background noise.",
              "Maintain a steady flow rate.",
              "Avoid contact between grains and mic."
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-emerald-800/80">
                <div className="w-5 h-5 rounded-full bg-emerald-200 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                  {i + 1}
                </div>
                {step}
              </li>
            ))}
          </ul>
        </section>
      </main>

      {/* Footer Navigation (Static/Mock) */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white/90 backdrop-blur-xl border-t border-stone-200 px-8 py-4 flex justify-between items-center z-50">
        <button className="flex flex-col items-center gap-1 text-emerald-600">
          <Activity className="w-5 h-5" />
          <span className="text-[10px] font-bold">Monitor</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-stone-400">
          <History className="w-5 h-5" />
          <span className="text-[10px] font-bold">Logs</span>
        </button>
        <div className="w-12 h-12 bg-emerald-600 rounded-full flex items-center justify-center -mt-10 shadow-lg border-4 border-white">
          <Waves className="w-6 h-6 text-white" />
        </div>
        <button className="flex flex-col items-center gap-1 text-stone-400">
          <Settings2 className="w-5 h-5" />
          <span className="text-[10px] font-bold">Devices</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-stone-400">
          <ChevronRight className="w-5 h-5 rotate-90" />
          <span className="text-[10px] font-bold">Profile</span>
        </button>
      </nav>
    </div>
  );
};

export default App;
