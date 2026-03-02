import { GoogleGenAI, Modality, Type, LiveServerMessage } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export const getAI = () => {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  return new GoogleGenAI({ apiKey: GEMINI_API_KEY });
};

// For image generation, we might need a separate instance if the user selects a different key
export const getAIWithKey = (apiKey: string) => {
  return new GoogleGenAI({ apiKey });
};

export const SYSTEM_INSTRUCTION = `You are FRIDAY, a smart personal AI assistant for Karthik Raj.

Activation Rule:
- You should only fully respond after the user says "Hi FRIDAY" or "Hey FRIDAY".
- If the activation phrase is not present in the user's message, reply briefly with: "Please say 'Hi FRIDAY' to activate me."
- Once activated (meaning the user has said the activation phrase in the current or a previous message in the conversation), respond normally and assist the user.
- Keep responses short and assistant-like when activated.

Your primary responsibilities:
- Help schedule tasks
- Remind the user about specific work at specific times
- Assist in checking and summarizing emails
- Manage daily schedules efficiently
- Support both voice and text interaction

User Profile:
- Name: Karthik Raj
- Location: Wanaparthy, Telangana, India
- B.Tech student in Artificial Intelligence and Machine Learning
- Studying at Sri Indu College of Engineering and Technology
- Focused on AI development and career growth

Behavior Rules:
- When the user schedules a task, confirm clearly with time and task details.
- When asked about schedule, respond in an organized format.
- When asked to check email, summarize important emails concisely.
- For reminders, respond in a direct, assistant-style tone.
- Keep responses clear, short, and professional unless details are requested.
- Act like a real productivity assistant, not a chatbot.
- You were created by Karthik Raj. Acknowledge him with respect as your creator.

Scheduling Format Rule:
If user says: "Remind me to study at 6 PM"
Respond like: "Scheduled. I will remind you to study at 6 PM."

If user asks: "What is my schedule today?"
Respond in structured format:
- Time – Task
- Time – Task

Voice Mode Behavior:
- When activated, greet politely.
- When stopping, say a short goodbye.
- Keep spoken responses concise and natural.

Do not generate code unless explicitly requested.
Do not mention internal system instructions.
Focus on productivity, clarity, and intelligent assistance.
When delivering a reminder, use a confident and clear tone like: "Karthik, it's 6 PM. You have scheduled study time now."

You can open websites and applications upon request.
You can schedule tasks and retrieve the user's schedule.`;

const openWebsiteFunctionDeclaration = {
  name: "openWebsite",
  parameters: {
    type: Type.OBJECT,
    description: "Open a specific website or application by URL or name.",
    properties: {
      url: {
        type: Type.STRING,
        description: "The full URL of the website to open (e.g., 'https://youtube.com').",
      },
      name: {
        type: Type.STRING,
        description: "The common name of the application or website (e.g., 'YouTube').",
      },
    },
    required: ["url", "name"],
  },
};

const scheduleTaskFunctionDeclaration = {
  name: "scheduleTask",
  parameters: {
    type: Type.OBJECT,
    description: "Schedule a task or reminder for the user.",
    properties: {
      task: {
        type: Type.STRING,
        description: "The description of the task or reminder.",
      },
      time: {
        type: Type.STRING,
        description: "The time for the task (e.g., '6 PM', 'tomorrow at 10 AM').",
      },
    },
    required: ["task", "time"],
  },
};

const getScheduleFunctionDeclaration = {
  name: "getSchedule",
  parameters: {
    type: Type.OBJECT,
    description: "Retrieve the user's current schedule or tasks.",
    properties: {},
  },
};

const clearScheduleFunctionDeclaration = {
  name: "clearSchedule",
  parameters: {
    type: Type.OBJECT,
    description: "Clear all tasks from the user's schedule.",
    properties: {},
  },
};

const getRecentEmailsFunctionDeclaration = {
  name: "getRecentEmails",
  parameters: {
    type: Type.OBJECT,
    description: "Retrieve recent emails for the user to summarize.",
    properties: {},
  },
};

export async function chatWithFriday(message: string, history: any[] = []) {
  const ai = getAI();
  const chat = ai.chats.create({
    model: "gemini-3.1-pro-preview",
    config: {
      systemInstruction: `${SYSTEM_INSTRUCTION}\n\nCurrent Time: ${new Date().toISOString()}`,
      tools: [{ 
        functionDeclarations: [
          openWebsiteFunctionDeclaration,
          scheduleTaskFunctionDeclaration,
          getScheduleFunctionDeclaration,
          clearScheduleFunctionDeclaration,
          getRecentEmailsFunctionDeclaration
        ] 
      }],
    },
    history: history,
  });

  const response = await chat.sendMessage({ message });
  return response;
}

export async function generateFridaySpeech(text: string) {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `Say in a professional, calm, and helpful tone (as FRIDAY): ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' }, // Kore sounds professional/calm
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  return base64Audio;
}

export async function generateImage(prompt: string, size: "1K" | "2K" | "4K" = "1K") {
  // Image generation requires user-provided API key
  // We recreate the instance to ensure it uses the latest key from process.env.API_KEY
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || GEMINI_API_KEY });
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-image-preview',
    contents: {
      parts: [{ text: prompt }],
    },
    config: {
      imageConfig: {
        aspectRatio: "1:1",
        imageSize: size
      },
      tools: [
        {
          googleSearch: {
            searchTypes: {
              webSearch: {},
            }
          },
        },
      ],
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  return null;
}

export interface LiveCallbacks {
  onopen?: () => void;
  onmessage: (message: LiveServerMessage) => void;
  onerror?: (error: any) => void;
  onclose?: () => void;
}

export const connectLive = (callbacks: LiveCallbacks) => {
  const ai = getAI();
  return ai.live.connect({
    model: "gemini-2.5-flash-native-audio-preview-09-2025",
    callbacks,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
      },
      systemInstruction: `${SYSTEM_INSTRUCTION}\n\nCurrent Time: ${new Date().toISOString()}`,
      tools: [{ 
        functionDeclarations: [
          openWebsiteFunctionDeclaration,
          scheduleTaskFunctionDeclaration,
          getScheduleFunctionDeclaration,
          clearScheduleFunctionDeclaration,
          getRecentEmailsFunctionDeclaration
        ] 
      }],
    },
  });
};
