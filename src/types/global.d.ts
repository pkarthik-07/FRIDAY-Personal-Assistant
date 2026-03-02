interface Window {
  aistudio?: {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  };
  webkitSpeechRecognition?: any;
  SpeechRecognition?: any;
}
