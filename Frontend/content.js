(function () {

    // ─────────────────────────────────────────────
    // STATE
    // ─────────────────────────────────────────────
    let conversationHistory = [];
    let chatHistory         = [];
    let currentVideoId      = null;
    const summaryCache      = {};

    // ─────────────────────────────────────────────
    // VIDEO METADATA HELPERS
    // ─────────────────────────────────────────────
    function getVideoId() {
        return new URL(window.location.href).searchParams.get("v");
    }

    function getVideoTitle() {
        const titleEl = document.querySelector("h1.ytd-watch-metadata yt-formatted-string");
        return titleEl
            ? titleEl.textContent.trim()
            : document.title.replace(" - YouTube", "").trim();
    }

    function getFormattedTimestamp(video) {
        if (!video) return "0:00";
        const minutes = Math.floor(video.currentTime / 60);
        const seconds = Math.floor(video.currentTime % 60);
        return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    }

    // ─────────────────────────────────────────────
    // BACKEND API
    // ─────────────────────────────────────────────
    let isChatRequestRunning    = false;
    let isSummaryRequestRunning = false;

    async function askAI(videoId, title, question, timestamp, type = "chat") {
        if (type === "chat"    && isChatRequestRunning)    return "Please wait for previous chat response...";
        if (type === "summary" && isSummaryRequestRunning) return "Summary already generating...";

        if (type === "chat")    isChatRequestRunning    = true;
        if (type === "summary") isSummaryRequestRunning = true;

        try {
            const response = await fetch("http://127.0.0.1:3000/ask", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ videoId, title, question, timestamp })
            });
            const data = await response.json();
            return data.answer || "No response";
        } catch (err) {
            return "Server error";
        } finally {
            if (type === "chat")    isChatRequestRunning    = false;
            if (type === "summary") isSummaryRequestRunning = false;
        }
    }

    // ─────────────────────────────────────────────
    // SUMMARY BOX
    // ─────────────────────────────────────────────
    function buildSummaryBox() {
        const box = document.createElement("div");
        box.id = "aiSummaryBox";
        box.innerHTML = `
            <div id="summaryHeader">
                <span>📋 Video Summary</span>
                <button id="closeSummaryBtn" title="Close">✕</button>
            </div>
            <div id="summaryContent">
                <div id="summaryBody"></div>
            </div>
            <div id="summaryFooter">
                <span id="summaryStatus"></span>
            </div>
        `;
        return box;
    }

    async function openSummaryBox() {
        const existing = document.getElementById("aiSummaryBox");
        if (existing) { existing.remove(); return; }

        const videoId    = getVideoId();
        const videoTitle = getVideoTitle();
        const box        = buildSummaryBox();
        document.body.appendChild(box);

        box.querySelector("#closeSummaryBtn").addEventListener("click", () => box.remove());

        const summaryBody   = box.querySelector("#summaryBody");
        const summaryStatus = box.querySelector("#summaryStatus");

        // ── Serve from cache ──
        if (summaryCache[videoId]) {
            renderSummary(summaryBody, summaryCache[videoId]);
            summaryStatus.textContent = "✔ Cached summary";
            return;
        }

        summaryStatus.textContent = "📋 Reading full transcript...";

        const loadingEl = document.createElement("div");
        loadingEl.className   = "summary-loading";
        loadingEl.textContent = "⏳ Generating summary, please wait...";
        summaryBody.appendChild(loadingEl);

        // ── Call dedicated /summary endpoint (NOT /ask) ──
        let summaryText = "";
        try {
            const response = await fetch("http://127.0.0.1:3000/summary", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ videoId, title: videoTitle })
            });
            const data = await response.json();

            if (!response.ok) {
                summaryText = "Error: " + (data.error || "Could not generate summary.");
            } else {
                summaryText = data.summary || "No summary returned.";
            }
        } catch (err) {
            summaryText = "Server error — make sure both servers are running.";
        }

        loadingEl.remove();
        summaryCache[videoId] = summaryText;
        renderSummary(summaryBody, summaryText);
        summaryStatus.textContent = "✔ Summary ready";
    }

    // ── Renders summary text with proper line breaks and section styling ──
    // Replaces summaryBody.textContent = ... (which strips all formatting)
    function renderSummary(container, text) {
        container.innerHTML = "";

        const lines = text.split("\n");

        lines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed) return;

            const el = document.createElement("div");

            // Section headings (lines starting with emoji heading markers)
            if (/^(🎯|🧠|⚡|📌|💡)/.test(trimmed)) {
                el.className   = "summary-section-heading";
                el.textContent = trimmed;

            // Bullet points
            } else if (trimmed.startsWith("•") || trimmed.startsWith("-")) {
                el.className   = "summary-bullet";
                el.textContent = trimmed;

            // Normal paragraph lines
            } else {
                el.className   = "summary-paragraph";
                el.textContent = trimmed;
            }

            container.appendChild(el);
        });
    }

    // ─────────────────────────────────────────────
    // CHAT BOX
    // ─────────────────────────────────────────────
    function buildChatBox() {
        const chatBox = document.createElement("div");
        chatBox.id = "aiChatBox";
        chatBox.innerHTML = `
            <div id="chatHeader">
                <span>🤖 AI Tutor</span>
                <button id="closeChatBtn" title="Close">✕</button>
            </div>
            <div id="chatContainer"></div>
            <p id="timeInfo"></p>
            <div id="inputArea">
                <input type="text" id="questionInput" placeholder="Ask something about this video..." autocomplete="off" />
                <button id="sendQuestion">Ask</button>
            </div>
        `;
        return chatBox;
    }

    function renderChat(chatBox) {
        const container = chatBox.querySelector("#chatContainer");
        container.innerHTML = "";
        chatHistory.forEach(item => {
            const q = document.createElement("div");
            q.className   = "chat-question";
            q.textContent = "You: " + item.question;
            const a = document.createElement("div");
            a.className   = "chat-answer";
            a.textContent = "AI: " + item.answer;
            container.appendChild(q);
            container.appendChild(a);
        });
        container.scrollTop = container.scrollHeight;
    }

    function bindChatHandlers(chatBox) {
        const sendBtn       = chatBox.querySelector("#sendQuestion");
        const questionInput = chatBox.querySelector("#questionInput");
        const timeInfo      = chatBox.querySelector("#timeInfo");
        const container     = chatBox.querySelector("#chatContainer");
        const closeBtn      = chatBox.querySelector("#closeChatBtn");

        closeBtn.addEventListener("click", () => chatBox.remove());

        async function handleSend() {
            const userQuestion = questionInput.value.trim();
            if (!userQuestion) { timeInfo.innerText = "Please type a question first."; return; }

            const video = document.querySelector("video");
            if (!video)  { timeInfo.innerText = "No video player found on this page."; return; }

            const videoId    = getVideoId();
            const videoTitle = getVideoTitle();
            const timestamp  = getFormattedTimestamp(video);

            questionInput.value = "";
            timeInfo.innerText  = `⏱ Asking at ${timestamp}...`;
            sendBtn.disabled    = true;
            sendBtn.textContent = "...";

            const loadingEl = document.createElement("div");
            loadingEl.className   = "chat-loading";
            loadingEl.textContent = "AI is thinking...";
            container.appendChild(loadingEl);
            container.scrollTop = container.scrollHeight;

            const answer = await askAI(videoId, videoTitle, userQuestion, timestamp, "chat");
            loadingEl.remove();

            conversationHistory.push({ role: "user",      content: userQuestion });
            conversationHistory.push({ role: "assistant", content: answer });
            if (conversationHistory.length > 20) conversationHistory = conversationHistory.slice(-20);

            chatHistory.push({ question: userQuestion, answer });
            if (chatHistory.length > 10) chatHistory.shift();

            timeInfo.innerText  = `⏱ Answered at timestamp ${timestamp}`;
            renderChat(chatBox);
            sendBtn.disabled    = false;
            sendBtn.textContent = "Ask";
            questionInput.focus();
        }

        sendBtn.addEventListener("click", handleSend);
        questionInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
        });
        setTimeout(() => questionInput.focus(), 100);
    }

    // ─────────────────────────────────────────────
    // FAB
    // ─────────────────────────────────────────────
    const FAB_SIZE = 52;

    function addButtons() {
        if (!window.location.href.includes("watch")) return;
        if (document.getElementById("aiFab")) return;

        // ── Build elements ──
        const fab = document.createElement("div");
        fab.id = "aiFab";

        const mainBtn = document.createElement("button");
        mainBtn.id = "aiFabMain";
        mainBtn.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L14.2 9.8L22 12L14.2 14.2L12 22L9.8 14.2L2 12L9.8 9.8L12 2Z" fill="white"/>
        </svg>`;

        // Menu is a body-level sibling — never clipped by fab overflow
        const menu = document.createElement("div");
        menu.id = "aiFabMenu";
        menu.innerHTML = `
            <button id="fabAskAI" class="fab-menu-item">
                <span class="fab-menu-icon">🤖</span>
                <span class="fab-menu-label">Ask AI</span>
            </button>
            <div class="fab-menu-divider"></div>
            <button id="fabSummary" class="fab-menu-item">
                <span class="fab-menu-icon">📋</span>
                <span class="fab-menu-label">Summary</span>
            </button>
        `;

        fab.appendChild(mainBtn);
        document.body.appendChild(fab);
        document.body.appendChild(menu);

        // ─────────────────────────────────────────
        // POSITIONING
        // CRITICAL ORDER:
        //   1. Define setFabPosition first
        //   2. Apply default (bottom-right)
        //   3. Override with saved position if it exists
        // Never call applyDefaultPosition after loading saved — it overwrites.
        // ─────────────────────────────────────────

        function setFabPosition(x, y) {
            // Clamp within viewport bounds
            const maxX = window.innerWidth  - FAB_SIZE;
            const maxY = window.innerHeight - FAB_SIZE;
            x = Math.max(0, Math.min(x, maxX));
            y = Math.max(0, Math.min(y, maxY));

            // Always use left/top — never right/bottom — so drag math is consistent
            fab.style.left   = x + "px";
            fab.style.top    = y + "px";
            fab.style.right  = "auto";
            fab.style.bottom = "auto";
        }

        // STEP 1: Default position = bottom-right corner
        setFabPosition(
            window.innerWidth  - FAB_SIZE - 24,
            window.innerHeight - FAB_SIZE - 24
        );

        // STEP 2: Override with saved position if available (must come AFTER default)
        try {
            const saved = localStorage.getItem("aiFabPos");
            if (saved) {
                const { x, y } = JSON.parse(saved);
                setFabPosition(x, y);
            }
        } catch (e) {
            // Corrupt saved data — stay at default
        }

        // ─────────────────────────────────────────
        // MENU POSITIONING — centered above FAB
        // ─────────────────────────────────────────
        function positionMenu() {
            const rect  = fab.getBoundingClientRect();
            const menuW = 148;
            const menuH = menu.offsetHeight || 92;
            const gap   = 10;

            // Horizontally center the menu over the FAB's center point
            let left = rect.left + (FAB_SIZE / 2) - (menuW / 2);
            // Place above the FAB
            let top  = rect.top - menuH - gap;

            // If it would go off the top, flip below instead
            if (top < 8) top = rect.bottom + gap;

            // Keep within horizontal viewport
            left = Math.max(8, Math.min(left, window.innerWidth - menuW - 8));

            menu.style.left = left + "px";
            menu.style.top  = top  + "px";
        }

        // ─────────────────────────────────────────
        // MENU OPEN / CLOSE
        // ─────────────────────────────────────────
        let menuOpen    = false;
        let didJustDrag = false;

        function openMenu() {
            positionMenu();
            menu.classList.add("open");
            mainBtn.classList.add("active");
            menuOpen = true;
        }

        function closeMenu() {
            menu.classList.remove("open");
            mainBtn.classList.remove("active");
            menuOpen = false;
        }

        // Click on main button: open/close menu (but not if we just finished dragging)
        mainBtn.addEventListener("click", () => {
            if (didJustDrag) { didJustDrag = false; return; }
            menuOpen ? closeMenu() : openMenu();
        });

        // Click anywhere else: close menu
        document.addEventListener("click", (e) => {
            if (!fab.contains(e.target) && !menu.contains(e.target)) closeMenu();
        });

        // ─────────────────────────────────────────
        // MENU ACTIONS
        // ─────────────────────────────────────────
        menu.querySelector("#fabAskAI").addEventListener("click", () => {
            closeMenu();
            const existing = document.getElementById("aiChatBox");
            if (existing) { existing.remove(); return; }
            const chatBox = buildChatBox();
            document.body.appendChild(chatBox);
            bindChatHandlers(chatBox);
        });

        menu.querySelector("#fabSummary").addEventListener("click", () => {
            closeMenu();
            openSummaryBox();
        });

        // ─────────────────────────────────────────
        // DRAG — direct mousedown, no double-click needed
        //
        // getBoundingClientRect() gives the true viewport position
        // for position:fixed elements. offsetLeft/offsetTop do NOT.
        //
        // A short drag-distance threshold distinguishes a drag from
        // a tap/click — so the menu still opens on a clean tap.
        // ─────────────────────────────────────────
        let dragOffsetX   = 0;
        let dragOffsetY   = 0;
        let dragStartX    = 0;
        let dragStartY    = 0;
        let dragging      = false;
        const DRAG_THRESHOLD = 4; // px — movement below this is treated as a click

        fab.addEventListener("mousedown", (e) => {
            // Only respond to left mouse button
            if (e.button !== 0) return;

            e.preventDefault();

            // Capture start point and offset from FAB's current top-left corner
            const rect  = fab.getBoundingClientRect();
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;
            dragStartX  = e.clientX;
            dragStartY  = e.clientY;
            dragging    = false;

            function onMouseMove(e) {
                const dx = Math.abs(e.clientX - dragStartX);
                const dy = Math.abs(e.clientY - dragStartY);

                // Only enter drag mode once the user has moved far enough
                if (!dragging && dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;

                if (!dragging) {
                    dragging    = true;
                    didJustDrag = true;
                    closeMenu();
                    fab.classList.add("dragging");
                }

                setFabPosition(
                    e.clientX - dragOffsetX,
                    e.clientY - dragOffsetY
                );

                // Keep menu in sync if somehow open
                if (menuOpen) positionMenu();
            }

            function onMouseUp() {
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup",   onMouseUp);

                fab.classList.remove("dragging");

                if (dragging) {
                    // Save the final position using getBoundingClientRect
                    // (reliable for position:fixed — offsetLeft is not)
                    const r = fab.getBoundingClientRect();
                    localStorage.setItem("aiFabPos", JSON.stringify({
                        x: r.left,
                        y: r.top
                    }));

                    // Block the subsequent click event from opening the menu
                    setTimeout(() => { didJustDrag = false; }, 200);
                }

                dragging = false;
            }

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup",   onMouseUp);
        });
    }

    // ─────────────────────────────────────────────
    // INIT
    // ─────────────────────────────────────────────
    addButtons();

    // ─────────────────────────────────────────────
    // SPA NAVIGATION WATCHER
    // On new video: reset chat + clear saved FAB position → default corner
    // summaryCache is intentionally preserved across videos
    // ─────────────────────────────────────────────
    let lastUrl = location.href;

    new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;

            const newVideoId = getVideoId();
            if (newVideoId !== currentVideoId) {
                currentVideoId      = newVideoId;
                conversationHistory = [];
                chatHistory         = [];
                localStorage.removeItem("aiFabPos"); // reset to default corner on new video
            }

            setTimeout(() => {
                document.getElementById("aiFab")?.remove();
                document.getElementById("aiFabMenu")?.remove();
                document.getElementById("aiChatBox")?.remove();
                document.getElementById("aiSummaryBox")?.remove();
                addButtons();
            }, 1500);
        }
    }).observe(document, { subtree: true, childList: true });

})();