require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ================= MEMORY =================
const videoMemory = {}; // { videoId: [ {question, answer}, ... ] }
const MAX_HISTORY = 10;

// ================= HELPER FUNCTIONS =================

// FIX 3: Now handles hh:mm:ss AND mm:ss formats correctly
function timeToSeconds(t) {
    if (!t) return 0;
    const parts = t.split(":").map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
}

function findIndex(segments, currentTime) {
    let index = 0;
    let minDiff = Infinity;

    segments.forEach((seg, i) => {
        const diff = Math.abs(seg.start - currentTime);
        if (diff < minDiff) {
            minDiff = diff;
            index = i;
        }
    });

    return index;
}

function getWindow(segments, index, size = 5) {
    const start = Math.max(0, index - size);
    const end = Math.min(segments.length, index + size + 1);
    return segments.slice(start, end);
}


// ================= MAIN ROUTE =================
app.post("/ask", async (req, res) => {
    try {
        const { videoId, title, question, timestamp } = req.body;

        if (!videoId || !question) {
            return res.status(400).json({ error: "Missing videoId or question" });
        }

        // ================= MEMORY INIT =================
        if (!videoMemory[videoId]) {
            videoMemory[videoId] = [];
        }

        const history = videoMemory[videoId];

        // FIX 1: Use `historyText` consistently — was `conversationHistory` in the prompt (undefined variable)
        const historyText = history
            .map((item, i) => `Q${i + 1}: ${item.question}\nA${i + 1}: ${item.answer}`)
            .join("\n\n");

        // ================= FETCH TRANSCRIPT (SAFE) =================
        let segments = [];

        try {
            const transcriptResponse = await axios.get(
                `http://127.0.0.1:5000/transcript?videoId=${videoId}`
            );
            segments = transcriptResponse.data.segments || [];
        } catch (e) {
            console.warn("[Transcript] Fetch failed → fallback mode (no context)");
        }

        // ================= BUILD CONTEXT =================
        let context = "No transcript available for this video.";

        if (segments.length > 0) {
            const currentTimeSec = timeToSeconds(timestamp);
            const index = findIndex(segments, currentTimeSec);
            const windowSegments = getWindow(segments, index);
            context = windowSegments.map(s => s.text).join(" ");
        }

        console.log("=== DEBUG ===");
        console.log("VideoId:", videoId, "| Timestamp:", timestamp);
        console.log("Context:", context.slice(0, 200));

        // ================= PROMPT =================
        // FIX 1: Changed ${conversationHistory} → ${historyText} so the variable actually exists
        const prompt = `
You are an AI tutor embedded in a YouTube learning assistant.
Teach like a senior mentor — precise, structured, and practical.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Video title     : ${title}
Timestamp       : ${timestamp}
Transcript      : ${context}
${historyText ? `Prior conversation:\n${historyText}\n` : ""}
Student question: ${question}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESPONSE LOGIC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 1 — CLASSIFY THE QUESTION

Trigger keywords: why, how, explain, example, detail, breakdown,
                  clarify, elaborate, walk me through, show me

If NONE of these are present → use MODE A
If ANY of these are present  → use MODE B

───────────────────────────────
MODE A — DIRECT ANSWER
(default for all first questions)
───────────────────────────────

Respond with exactly this:

🎯 [One clear, confident sentence that directly answers the question.]

Nothing else. No bullets. No explanation. No conclusion.

───────────────────────────────
MODE B — FULL EXPLANATION
(triggered by keywords above, or any follow-up asking for more)
───────────────────────────────

Respond using this exact structure:

🎯 Direct answer
   [One sentence. Answer the question immediately and confidently.]

🧠 Explanation
   • [Core idea — one line]
   • [Next detail or step — one line]
   • [Add more bullets only if genuinely needed]
   [Insert a short code block here IF the concept involves syntax or code]

⚠️ Key insight
   [The single most important thing to remember — one line.]

✅ Practical note
   • [What to do or watch out for in practice — one line]
   • [Implementation tip or real-world relevance — one line]

📝 Conclusion
   [2–3 lines. Summarize the full answer in plain English.
    Connect it back to the video topic.
    Leave the student with a clear mental picture.]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRICT RULES (apply to both modes)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TONE & OPENINGS
- Never open with: "Great question", "Sure!", "Of course", "Certainly", or any filler
- Never repeat or rephrase the student's question back to them
- Use a real-world analogy inside Explanation bullets if the student seems confused

FORMATTING
- Emojis appear ONLY on the 5 section headings — nowhere else in the response
- Each bullet = one idea, one line — never combine two ideas in one bullet
- No paragraphs longer than 2 lines — break them into bullets
- Heading and content stay in the same visual block (no orphaned headings)

CONTENT
- Check conversation history before answering — do NOT re-explain already covered concepts
- If the answer is not in the transcript, use general knowledge relevant to the video topic
- The 📝 Conclusion must summarize the FULL answer — not just echo the last bullet
- Prefer precision over completeness — never pad, never repeat
`.trim();

// ================= ADD THIS ROUTE TO server.js =================
// Place this block AFTER your /ask route, BEFORE the server listen line

app.post("/summary", async (req, res) => {
    try {
        const { videoId, title } = req.body;

        if (!videoId) {
            return res.status(400).json({ error: "Missing videoId" });
        }

        // ── Fetch the FULL transcript (not just a window) ──
        let fullText = "";

        try {
            const transcriptResponse = await axios.get(
                `http://127.0.0.1:5000/transcript?videoId=${videoId}`
            );
            const segments = transcriptResponse.data.segments || [];

            if (segments.length === 0) {
                return res.status(404).json({ error: "No transcript found for this video." });
            }

            // Join ALL segments — not just a 5-segment window
            fullText = segments.map(s => s.text).join(" ");

            // Trim to ~12000 chars to stay within LLM context limits
            // ~12000 chars ≈ 3000 tokens — safe for llama3-70b with 800 output tokens
            if (fullText.length > 12000) {
                fullText = fullText.slice(0, 12000) + "...";
            }

        } catch (e) {
            console.warn("[Summary] Transcript fetch failed:", e.message);
            return res.status(503).json({ error: "Could not fetch transcript. Make sure the Python server is running." });
        }

        console.log("[Summary] Transcript length:", fullText.length, "chars");

        // ── Summary prompt ──
        const prompt = `
You are an expert video summarizer. Your job is to extract the real soul and meaning of this video — not just list topics.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VIDEO INFO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Title      : ${title}
Transcript : ${fullText}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR TASK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Write a structured summary using EXACTLY this format:

🎯 Core Idea
[1–2 sentences. What is this video REALLY about? What is the single central insight the instructor is building toward?]

🧠 Key Concepts Covered
• [Concept 1 — one line: what it is and why it matters in this video]
• [Concept 2 — one line]
• [Concept 3 — one line]
• [Add more if genuinely present — do not pad]

⚡ Most Important Insight
[The single "aha moment" of this video. The one thing a student must walk away remembering.]

📌 How It Works (Step-by-step if applicable)
• [Step or mechanism 1 — concrete, not vague]
• [Step or mechanism 2]
• [Step or mechanism 3]
[Skip this section entirely if the video is conceptual, not procedural]

💡 Why This Matters
[2–3 lines. Real-world relevance. Why should a student care about this topic beyond the exam?]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRICT RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Write from the VIDEO'S perspective — summarize what was actually taught, not generic knowledge
- Each bullet = one concrete idea, one line — never vague filler like "the video explains..."
- No intro phrases like "In this video..." or "The instructor discusses..."
- No emojis except on the 5 section headings
- If a section does not apply (e.g. no step-by-step process), skip it entirely
- Precision over length — a tight 200-word summary beats a bloated 500-word one
`.trim();

        // ── LLM Call ──
        const response = await axios.post(
            "https://integrate.api.nvidia.com/v1/chat/completions",
            {
                model: "meta/llama3-70b-instruct",
                messages: [{ role: "user", content: prompt }],
                max_tokens: 900,
                temperature: 0.3   // lower = more factual, less hallucination
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );

        const summary = response.data.choices?.[0]?.message?.content?.trim() || "Could not generate summary.";

        console.log("[Summary] Generated successfully for:", videoId);
        res.json({ summary });

    } catch (err) {
        console.error("[/summary Error]", err.response?.data || err.message);
        console.error("[/summary Stack]", err.stack);

        if (err.response?.status === 429) {
            return res.status(429).json({ error: "Rate limit exceeded. Please wait a moment." });
        }

        res.status(500).json({
            error: "Summary generation failed.",
            detail: err.response?.data?.message || err.message
        });
    }
});

        // ================= LLM CALL =================
        const response = await axios.post(
            "https://integrate.api.nvidia.com/v1/chat/completions",
            {
                model: "meta/llama3-70b-instruct",
                messages: [{ role: "user", content: prompt }],
                max_tokens: 800,
                temperature: 0.4
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );

        const answer = response.data.choices?.[0]?.message?.content?.trim() || "No response";

        // ================= STORE MEMORY =================
        history.push({ question, answer });

        if (history.length > MAX_HISTORY) {
            history.shift();
        }

        // ================= RESPONSE =================
        res.json({ answer });

    } catch (err) {
        // FIX 2: Log the full error so you can actually debug what went wrong
        console.error("[/ask Error]", err.response?.data || err.message);
        console.error("[/ask Stack]", err.stack);

        if (err.response?.status === 429) {
            return res.status(429).json({ error: "Rate limit exceeded. Please wait a moment and try again." });
        }

        // FIX 2: Return the actual error message to the frontend during development
        res.status(500).json({
            error: "AI request failed.",
            detail: err.response?.data?.message || err.message
        });
    }
});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[Server] Running on http://127.0.0.1:${PORT}`);
});