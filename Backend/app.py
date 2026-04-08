from flask import Flask, request, jsonify
from flask_cors import CORS
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import TranscriptsDisabled, NoTranscriptFound, VideoUnavailable
from googletrans import Translator
import re
import time

app = Flask(__name__)
CORS(app)

ytt_api = YouTubeTranscriptApi()
translator = Translator()
transcript_cache = {}

# Google Translate safe chunk size (keep under 5000 chars)
CHUNK_SIZE = 4500


def extract_video_id(raw: str) -> str | None:
    raw = raw.strip()
    if re.match(r'^[a-zA-Z0-9_-]{11}$', raw):
        return raw
    for pattern in [
        r'(?:v=)([a-zA-Z0-9_-]{11})',
        r'(?:youtu\.be/)([a-zA-Z0-9_-]{11})',
        r'(?:embed/)([a-zA-Z0-9_-]{11})',
        r'(?:shorts/)([a-zA-Z0-9_-]{11})',
    ]:
        match = re.search(pattern, raw)
        if match:
            return match.group(1)
    return None


def translate_to_english(text: str) -> str:
    """
    Splits long text into chunks and translates each to English.
    Retries once on failure with a short delay.
    """
    # Split into chunks at word boundaries
    chunks = []
    while len(text) > CHUNK_SIZE:
        split_at = text.rfind(' ', 0, CHUNK_SIZE)
        if split_at == -1:
            split_at = CHUNK_SIZE
        chunks.append(text[:split_at])
        text = text[split_at:].strip()
    chunks.append(text)

    translated = []
    for i, chunk in enumerate(chunks):
        for attempt in range(2):  # retry once on failure
            try:
                result = translator.translate(chunk, dest='en', src='auto')
                translated.append(result.text)
                break
            except Exception as e:
                if attempt == 0:
                    time.sleep(1)  # wait 1 second and retry
                else:
                    raise e

    return ' '.join(translated)


def get_transcript(video_id: str) -> dict:
    if video_id in transcript_cache:
        print(f"[Cache] Hit: {video_id}")
        return transcript_cache[video_id]

    try:
        detected_lang = 'en'

        # Step 1: Try English directly
        try:
            fetched = ytt_api.fetch(video_id, languages=['en', 'en-US', 'en-GB'])
            segments = [
                    {"text": s.text, "start": s.start}
                   for s in fetched
                   ]
            print(f"[Transcript] Got English directly for {video_id}")

        except NoTranscriptFound:
            # Step 2: Get any available transcript
            transcript_list = ytt_api.list(video_id)
            available_langs = [t.language_code for t in transcript_list]
            print(f"[Transcript] Available languages: {available_langs}")

            try:
                transcript_obj = transcript_list.find_manually_created_transcript(available_langs)
            except NoTranscriptFound:
                transcript_obj = transcript_list.find_generated_transcript(available_langs)

            detected_lang = transcript_obj.language_code
            print(f"[Transcript] Using: {detected_lang}")

            fetched = transcript_obj.fetch()
            segments = [
                     {"text": s.text, "start": s.start}
                     for s in fetched
    ]

        if not segments:
            return {"error": "Transcript is empty"}

        # Step 3: Translate to English if needed
        if detected_lang not in ('en', 'en-US', 'en-GB'):
            print(f"[Translation] Translating {detected_lang} → English ...")
            text = translate_to_english(text)
            print(f"[Translation] Done.")

        result = {
            "segments": segments,
            "original_language": detected_lang
}
        transcript_cache[video_id] = result
        return result

    except TranscriptsDisabled:
        return {"error": "Transcripts are disabled for this video"}
    except VideoUnavailable:
        return {"error": "Video is unavailable or does not exist"}
    except NoTranscriptFound:
        return {"error": "No transcript found in any language"}
    except Exception as e:
        print(f"[ERROR] {type(e).__name__}: {e}")
        return {"error": f"Unexpected error: {str(e)}"}


@app.route("/transcript", methods=["GET"])
def transcript_api():
    raw = request.args.get("videoId", "").strip()

    if not raw:
        return jsonify({"transcript": None, "error": "Missing 'videoId' parameter"}), 400

    video_id = extract_video_id(raw)
    if not video_id:
        return jsonify({"transcript": None, "error": "Invalid YouTube video ID or URL"}), 400

    result = get_transcript(video_id)

    if "segments" in result:
        return jsonify({
            "segments": result["segments"],
            "videoId": video_id,
            "original_language": result.get("original_language", "en")
        }), 200
    else:
        return jsonify({"transcript": None, "error": result["error"]}), 404


@app.route("/clear-cache", methods=["POST"])
def clear_cache():
    transcript_cache.clear()
    return jsonify({"message": "Cache cleared"}), 200


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "cached_videos": len(transcript_cache)}), 200


if __name__ == "__main__":
    app.run(port=5000, debug=True)