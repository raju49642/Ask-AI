# Ask AI — YouTube AI Tutor

A Chrome extension that turns YouTube into an interactive study companion. Ask questions at the current point in a video or generate a structured summary from its transcript.

## Features

- Context-aware questions using the transcript around the current timestamp
- Conversation memory per video
- Structured video summaries
- Transcript translation to English when needed

## Architecture

- **Frontend:** Chrome extension (JavaScript, HTML, CSS)
- **Node backend:** Express API on port `3000`; sends chat-completion requests to Groq
- **Python transcript service:** Flask API on port `5000`; retrieves and translates YouTube transcripts
- **LLM:** Groq, using `openai/gpt-oss-20b`

## Prerequisites

- Node.js
- Python 3
- A Groq API key from [GroqCloud](https://console.groq.com/keys)

## Setup

1. Install the Node backend dependencies:

   ```bash
   cd Backend
   npm install
   ```

2. Create `Backend/.env` with your own credentials. Never commit this file.

   ```env
   GROQ_API_KEY=your_groq_api_key
   PORT=3000
   ```

3. Install the Python transcript-service dependencies:

   ```bash
   pip install flask flask-cors youtube-transcript-api googletrans==4.0.0-rc1
   ```

4. In one terminal, start the transcript service:

   ```bash
   cd Backend
   python app.py
   ```

5. In another terminal, start the Node backend:

   ```bash
   cd Backend
   npm start
   ```

6. Load the `Frontend` directory as an unpacked extension in Chrome.

The extension calls the Node API at `http://127.0.0.1:3000`, which fetches transcripts through the local Python service at `http://127.0.0.1:5000`.

## API routes

- `POST /ask` — returns an answer grounded in a timestamped transcript window.
- `POST /summary` — returns a structured summary of a video transcript.

## Project structure

```text
Ask-AI/
├── Backend/
│   ├── server.js       # Express + Groq integration
│   └── app.py          # Transcript service
├── Frontend/           # Chrome extension
├── .gitignore
└── README.md
```

## Security

Keep `GROQ_API_KEY` only in `Backend/.env`. Do not expose it in the frontend, commit it to Git, or share it in screenshots/logs.
