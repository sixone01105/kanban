import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API route for Gemini Consult
  app.post("/api/gemini/consult", async (req, res) => {
    try {
      const { prompt, tasks, userApiKey } = req.body;
      
      const apiKey = userApiKey || req.headers["x-gemini-api-key"] || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(400).json({ error: "請先在諮詢面板中輸入您的個人 Gemini API Key！此金鑰僅會保存在您本地的瀏覽器中，安全有保障。" });
      }

      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      // Prepare context about current board tasks
      const formattedTasks = tasks && Array.isArray(tasks)
        ? tasks.map(t => {
            const statusLabel = t.status === 0 ? "待辦" : t.status === 1 ? "進行中" : "已完成";
            return `- [${statusLabel}] ${t.text}`;
          }).join("\n")
        : "（目前看板上沒有任何任務）";

      const systemInstruction = `你是一位專業的個人看板生產力顧問（Kanban Productivity Mentor）。你的工作是根據使用者的提問，以及他們目前看板上的任務列表，提供最專業、具體且具可操作性的建議或步驟拆解。
請務必使用繁體中文回答，語氣要親切、專業、具有啟發性。如果使用者要求你拆解成具體任務，請提供可以直接新增到看板的簡短行動項目。

使用者目前的 Kanban 看板任務：
${formattedTasks}`;

      const candidateModels = [
        "gemini-3.5-flash",
        "gemini-flash-latest",
        "gemini-3.1-flash-lite"
      ];

      let response = null;
      let lastError = null;

      const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      for (const modelName of candidateModels) {
        let attempt = 0;
        const maxAttempts = 3;
        
        while (attempt < maxAttempts) {
          try {
            attempt++;
            console.log(`Attempting Gemini generation with model: ${modelName} (Attempt ${attempt}/${maxAttempts})`);
            
            response = await ai.models.generateContent({
              model: modelName,
              contents: prompt || "根據我目前的任務板，給我一些調整專案優先順序、進度推進的綜合建議。",
              config: {
                systemInstruction: systemInstruction,
                temperature: 0.7,
              },
            });
            
            if (response) {
              console.log(`Successfully generated content using model: ${modelName} on attempt ${attempt}`);
              break;
            }
          } catch (err: any) {
            const errStr = JSON.stringify(err) || err.message || "";
            const isTransient = errStr.includes("503") || 
                              errStr.includes("UNAVAILABLE") || 
                              errStr.includes("demand") || 
                              errStr.includes("rate") ||
                              errStr.includes("temporary");
            
            console.warn(`Model ${modelName} attempt ${attempt} failed:`, err.message || err);
            lastError = err;
            
            if (isTransient && attempt < maxAttempts) {
              const backoffTime = attempt * 1200; // 1.2s, 2.4s
              console.log(`Transient error detected. Backing off for ${backoffTime}ms before retry...`);
              await sleep(backoffTime);
            } else {
              break; // Not a transient error or exhausted attempts, move to next model
            }
          }
        }
        
        if (response) {
          break; // successfully got response, exit models loop
        }
      }

      if (!response) {
        throw lastError || new Error("所有候選的模型目前皆處於高負載狀態，請稍後再試。");
      }

      const responseText = response.text || "沒有產生任何回應。";
      res.json({ text: responseText });
    } catch (error: any) {
      console.error("Gemini API Error:", error);
      res.status(500).json({ error: error.message || "呼叫 Gemini API 時發生未知錯誤。" });
    }
  });

  // Vite middleware for development or serving built static files for production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
