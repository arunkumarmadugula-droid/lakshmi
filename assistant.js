(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const localDay = value => {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const priorityWeight = { high: 3, medium: 2, low: 1 };
  let action = "ask";
  let lastResponse = "";
  let recognition = null;
  let visualData = "";
  let strokes = [];
  let activeStroke = null;
  let scribeMode = "write";
  let scribeOutcome = "tasks";

  function app() { return window.VidyaApp; }
  function state() { return app()?.getState?.(); }

  function speak(text) {
    if (!("speechSynthesis" in window) || !text) { app()?.toast?.("Spoken responses are not available in this browser"); return; }
    speechSynthesis.cancel();
    const clean = String(text).replace(/\s+/g, " ").trim().slice(0, 3800);
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = "en-CA"; utterance.rate = .98; utterance.pitch = 1;
    const voices = speechSynthesis.getVoices();
    utterance.voice = voices.find(voice => /en-CA/i.test(voice.lang)) || voices.find(voice => /^en/i.test(voice.lang)) || null;
    speechSynthesis.speak(utterance);
  }

  function response(text, html = "") {
    lastResponse = text || "";
    const target = $("#assistantResponse");
    if (target) target.innerHTML = html || `<p>${esc(text)}</p>`;
  }

  function taskScore(task) {
    const time = task.dueAt ? new Date(`${task.dueAt}T23:59:59`).getTime() : new Date(task.startAt || task.due || Date.now() + 14 * 864e5).getTime();
    const urgency = Math.max(0, 4 - (time - Date.now()) / 864e5);
    return (priorityWeight[task.priority] || 2) * 5 + urgency - Math.min(task.estimate || 25, 120) / 100;
  }

  function openTasks() { return (state()?.tasks || []).filter(task => !task.done); }

  function topTasks(limit = 3) { return [...openTasks()].sort((a, b) => taskScore(b) - taskScore(a)).slice(0, limit); }

  function reply(text) {
    response(text);
    if (state()?.speakResponses) speak(text);
  }

  function findTask(command) {
    const quoted = command.match(/[“"]([^”"]+)[”"]/u)?.[1]?.toLowerCase();
    const stop = new Set(["a", "an", "and", "at", "by", "change", "complete", "delete", "done", "edit", "finish", "for", "from", "in", "mark", "move", "my", "of", "on", "postpone", "reminder", "remove", "reschedule", "task", "the", "this", "to", "today", "tomorrow"]);
    const tokens = String(quoted || command).toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(token => token.length > 1 && !stop.has(token)) || [];
    const best = openTasks().map(task => {
      const title = task.title.toLowerCase();
      const score = quoted && title.includes(quoted) ? 100 : tokens.reduce((total, token) => total + (title.includes(token) ? 1 : 0), 0);
      return { task, score };
    }).sort((a, b) => b.score - a.score || taskScore(b.task) - taskScore(a.task))[0];
    return best?.score > 0 ? best.task : null;
  }

  function handleTaskCommand(command) {
    const listRequest = /\b(?:show|list|read|tell me|what(?:'s| is| are))\b.*\b(?:tasks?|reminders?|priorities|schedule)\b/i.test(command);
    if (listRequest) {
      const tasks = topTasks(5);
      const text = tasks.length ? `Your next ${tasks.length} ${tasks.length === 1 ? "priority is" : "priorities are"}: ${tasks.map((task, index) => `${index + 1}, ${task.title}${task.startAt ? `, ${app().formatDue(task.startAt, true)}` : ", in Inbox"}`).join(". ")}.` : "You have no open tasks.";
      reply(text); return true;
    }
    const operation = command.match(/^\s*(?:please\s+)?(?:mark\s+)?(complete|finish|done|edit|change|reschedule|move|postpone|delete|remove|cancel)\b/i)?.[1]?.toLowerCase();
    if (!operation) return false;
    const task = findTask(command);
    if (!task) { reply("I could not confidently match that instruction to an open task. Say the exact task title, or open Today and choose it."); return true; }
    if (["complete", "finish", "done"].includes(operation)) {
      task.done = true; task.completedAt = new Date().toISOString(); task.updatedAt = task.completedAt;
      app().saveState(); app().renderTasks(); app().renderDailyPulse(); renderPlanner(); reply(`Completed “${task.title}”.`); return true;
    }
    if (["reschedule", "move", "postpone"].includes(operation)) {
      const timingCommand = command.replace(/[“"][^”"]+[”"]/gu, "");
      const intent = app().parseIntent(timingCommand);
      if (intent.due) {
        task.startAt = intent.due; task.due = intent.due; task.updatedAt = new Date().toISOString();
        app().saveState(); app().renderTasks(); renderPlanner(); reply(`Moved “${task.title}” to ${app().formatDue(intent.due, true)}.`); return true;
      }
    }
    app().closeDialog($("#assistantDialog"));
    app().openTaskDialog(task);
    app().toast(["delete", "remove", "cancel"].includes(operation) ? "Review the task, then tap Delete to confirm" : "Edit the task and save your changes");
    return true;
  }

  function composeBrief(kind = "morning") {
    const s = state();
    const open = openTasks();
    const top = topTasks(3);
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = localDay(tomorrow);
    const tomorrowTasks = open.filter(task => task.startAt && localDay(task.startAt) === tomorrowKey).sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
    const unread = app().getFeedItems().filter(item => !(s.readFeedIds || []).includes(item.id) && !(s.archivedFeedIds || []).includes(item.id));
    if (kind === "tomorrow") {
      if (!tomorrowTasks.length) return "Tomorrow is currently clear. Review your Inbox and choose no more than three priorities before the day begins.";
      return `Tomorrow has ${tomorrowTasks.length} planned item${tomorrowTasks.length === 1 ? "" : "s"}. First: ${tomorrowTasks[0].title}. ${tomorrowTasks.slice(1, 3).map((task, index) => `Then ${index + 2}: ${task.title}.`).join(" ")} Estimated planned work: ${tomorrowTasks.reduce((sum, task) => sum + (task.estimate || 25), 0)} minutes.`;
    }
    if (kind === "unread") {
      if (!unread.length) return "Your knowledge edition is caught up. Vidya will check for fresh research again when five hours have elapsed and the app is opened.";
      return `You have ${unread.length} unread knowledge item${unread.length === 1 ? "" : "s"}. Start with: ${unread[0].title}. Why it matters: ${unread[0].summary}`;
    }
    if (!top.length) return `Good ${new Date().getHours() < 12 ? "morning" : "day"}. You have no open commitments. Protect time for one useful idea and one meaningful connection.`;
    const dueToday = open.filter(task => task.startAt && localDay(task.startAt) <= localDay(new Date())).length;
    return `Good ${new Date().getHours() < 12 ? "morning" : "day"}. You have ${open.length} open commitment${open.length === 1 ? "" : "s"}, with ${dueToday} scheduled or overdue today. Your first priority is ${top[0].title}, estimated at ${top[0].estimate || 25} minutes. ${top[1] ? `Second is ${top[1].title}. ` : ""}${unread.length ? `Your knowledge queue has ${unread.length} unread item${unread.length === 1 ? "" : "s"}.` : "Your knowledge queue is caught up."}`;
  }

  function briefValue(value, fallback) {
    if (typeof value === "string") return value;
    if (value && typeof value === "object") return value.title || value.text || value.summary || value.action || fallback;
    return fallback;
  }

  function latestStructuredBrief() {
    const row = state()?.briefHistory?.[0];
    return row?.brief || row?.content || null;
  }

  function buildBriefSnapshot() {
    const s = state();
    const docs = app().getLibraryDocs();
    return {
      openTasks: openTasks().slice(0, 100).map(task => ({ id: task.id, title: task.title, subject: task.subject, tags: task.tags || [], priority: task.priority, startAt: task.startAt || task.due || null, dueAt: task.dueAt || null, estimate: task.estimate || 25 })),
      unreadFeed: app().getFeedItems().filter(item => !(s.readFeedIds || []).includes(item.id) && !(s.archivedFeedIds || []).includes(item.id)).slice(0, 50).map(item => ({ id: item.id, title: item.title, subject: item.subject, summary: item.summary, sourceUrl: item.sourceUrl || "" })),
      libraryItems: docs.slice(0, 30).map(doc => ({ id: doc.id, title: doc.name, type: doc.type, subject: doc.subject, summary: doc.summary || "", excerpt: doc.chunks?.[0]?.text?.slice(0, 650) || "", addedAt: doc.addedAt })),
      interests: (s.interests || []).filter(item => item.on).slice(0, 100).map(item => `${item.core ? "Core: " : ""}${item.name}`),
      activity: [{ type: "library", count: docs.length }, { type: "open_tasks", count: openTasks().length }, { type: "unread_knowledge", count: app().getFeedItems().filter(item => !(s.readFeedIds || []).includes(item.id) && !(s.archivedFeedIds || []).includes(item.id)).length }]
    };
  }

  function renderCommandBrief() {
    if (!state() || !$("#commandBrief")) return;
    const s = state();
    const structured = latestStructuredBrief();
    const top = topTasks(1)[0];
    const unread = app().getFeedItems().filter(item => !(s.readFeedIds || []).includes(item.id) && !(s.archivedFeedIds || []).includes(item.id));
    const recent = [...app().getLibraryDocs()].sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))[0];
    const priority = structured?.priorities?.[0];
    const research = structured?.researchHighlights?.[0];
    const library = structured?.libraryConnections?.[0];
    const coaching = structured?.reflection || structured?.actions?.[0];
    $("#commandBriefTasks").textContent = briefValue(priority, top?.title || "Choose one meaningful priority");
    $("#commandBriefResearch").textContent = briefValue(research, unread[0]?.title || "Your knowledge queue is caught up");
    $("#commandBriefLibrary").textContent = briefValue(library, recent ? `${recent.name} is ready for questions` : "Add one trusted source to build expertise");
    $("#commandBriefCoach").textContent = briefValue(coaching, top ? `What would make “${top.title}” easier to finish?` : "What should you learn or decide next?");
    const latest = s.briefHistory?.[0];
    $("#commandBriefGenerated").textContent = structured ? (structured.overview || latest?.text || "Your synthesized command brief is ready.") : `${composeBrief("morning")} Connect the secure engine for scheduled research synthesis.`;
    const live = Boolean(structured);
    $("#commandBriefStatus").textContent = live ? "AI brief" : "Local";
    $("#commandBriefStatus").classList.toggle("is-live", live);
  }

  async function generateCommandBrief(kind = "manual") {
    const button = $("#runCommandBrief");
    if (button) { button.disabled = true; button.textContent = "Building…"; }
    try {
      if (app().hasSecureEngine?.()) {
        const data = await app().callSecureEngine("brief.generate", { kind, snapshot: buildBriefSnapshot() });
        state().briefHistory = [{ id: `brief-${Date.now()}`, kind, brief: data.brief || data.data || {}, text: data.text || "", sources: data.sources || [], createdAt: new Date().toISOString() }, ...(state().briefHistory || [])].slice(0, 30);
        app().saveState(); renderCommandBrief(); app().renderCostMonitor?.();
        app().toast("Fresh AI command brief is ready");
      } else {
        renderCommandBrief();
        app().toast("Local command brief rebuilt. Connect the secure engine for research synthesis.");
      }
    } catch (error) { app().toast(`Brief could not be generated: ${error.message}`); }
    finally { if (button) { button.disabled = false; button.textContent = "Build fresh brief"; } }
  }

  async function syncLatestBrief() {
    if (!app().hasSecureEngine?.()) return;
    try {
      const data = await app().callSecureEngine("brief.latest", { kind: "daily" });
      const record = data.brief;
      if (!record?.content) return;
      const exists = (state().briefHistory || []).some(item => item.id === record.id);
      if (!exists) state().briefHistory = [{ id: record.id, kind: record.kind, brief: record.content, text: record.content.overview || "", sources: record.sources || [], createdAt: record.created_at }, ...(state().briefHistory || [])].slice(0, 30);
      app().saveState(); renderCommandBrief();
    } catch { /* The local brief remains useful when the cloud is unreachable. */ }
  }

  function deliverBrief(kind, showAssistant = true) {
    const text = composeBrief(kind);
    response(text);
    app().addChat({ role: "ai", text, html: `<h3>${kind === "tomorrow" ? "Tomorrow priorities" : kind === "unread" ? "Unread knowledge" : "Morning brief"}</h3><p>${esc(text)}</p>`, meta: "Vidya · local planning brief" });
    if (showAssistant) app().openDialog("assistantDialog");
    if (state().speakResponses) speak(text);
    return text;
  }

  function previewCapture(text) {
    const target = $("#quickCapturePreview");
    if (!target) return;
    if (!text.trim()) { target.innerHTML = ""; return; }
    const intent = app().parseIntent(text);
    const chips = [`@${intent.subject}`, ...intent.tags.map(tag => `#${tag}`), intent.due ? app().formatDue(intent.due, true) : "Inbox", `${intent.estimate || 25} min`, `${intent.priority} priority`];
    target.innerHTML = chips.map(value => `<span class="capture-chip">${esc(value)}</span>`).join("");
  }

  function renderPlanner() {
    if (!state() || !$("#weekStrip")) return;
    const s = state();
    const top = topTasks(3);
    $("#topPriorities").innerHTML = top.length ? top.map((task, index) => `<button class="priority-preview" data-planner-task="${esc(task.id)}"><span>${index + 1}</span><div><b>${esc(task.title)}</b><small>@${esc(task.subject)} · ${task.estimate || 25} min</small></div></button>`).join("") : `<p class="empty-copy">No urgent work. Capture one meaningful next action.</p>`;
    $("#planningSummary").textContent = `${openTasks().length} open · ${top.reduce((sum, task) => sum + (task.estimate || 25), 0)} minutes across your Top ${top.length || 0}`;

    const days = [];
    const start = new Date(); start.setHours(12, 0, 0, 0);
    for (let index = 0; index < 7; index += 1) { const day = new Date(start); day.setDate(day.getDate() + index); days.push(day); }
    if (!s.plannerDate || !days.some(day => localDay(day) === s.plannerDate)) s.plannerDate = localDay(days[0]);
    $("#weekStrip").innerHTML = days.map(day => {
      const key = localDay(day);
      const count = openTasks().filter(task => task.startAt && localDay(task.startAt) === key).length;
      return `<button class="week-day ${key === s.plannerDate ? "is-active" : ""}" data-planner-date="${key}" aria-pressed="${key === s.plannerDate}"><span>${new Intl.DateTimeFormat(undefined,{weekday:"short"}).format(day)}</span><b>${day.getDate()}</b><small>${count ? `${count} task${count === 1 ? "" : "s"}` : "Clear"}</small></button>`;
    }).join("");

    const selected = openTasks().filter(task => task.startAt && localDay(task.startAt) === s.plannerDate).sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
    $("#dayTimeline").innerHTML = selected.length ? selected.map(task => {
      const date = new Date(task.startAt);
      const overdue = date < new Date();
      return `<div class="timeline-row ${overdue ? "is-overdue" : ""}"><span class="timeline-time">${new Intl.DateTimeFormat(undefined,{hour:"numeric",minute:"2-digit"}).format(date)}</span><i class="timeline-dot"></i><button class="timeline-copy" data-planner-task="${esc(task.id)}"><b>${esc(task.title)}</b><small>@${esc(task.subject)}${task.dueAt ? ` · deadline ${esc(task.dueAt)}` : ""}</small></button><span class="timeline-duration">${task.estimate || 25}m</span></div>`;
    }).join("") : `<div class="timeline-empty">No timed tasks on this day. Use Quick capture or choose a different date.</div>`;
  }

  function startRecognition(target, autoSubmit = false) {
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) { target?.focus(); app().toast("Voice recognition is unavailable here. Use the keyboard, Apple Pencil Scribble, or Siri Dictate in Shortcuts."); return; }
    recognition?.abort?.();
    recognition = new Speech(); recognition.lang = "en-CA"; recognition.interimResults = true; recognition.continuous = false;
    const buttons = [$("#assistantVoiceButton"), $("#quickCaptureVoice")].filter(Boolean); buttons.forEach(button => button.classList.add("is-listening"));
    recognition.onresult = event => {
      const transcript = [...event.results].map(result => result[0].transcript).join(" ");
      target.value = transcript;
      if (target.id === "quickCaptureInput") previewCapture(transcript);
      if (event.results[event.results.length - 1].isFinal && autoSubmit) $("#assistantForm").requestSubmit();
    };
    recognition.onerror = event => app().toast(event.error === "not-allowed" ? "Microphone permission was not granted" : "I could not hear that clearly. Try again or type instead.");
    recognition.onend = () => buttons.forEach(button => button.classList.remove("is-listening"));
    recognition.start();
  }

  function setAssistantAction(next) {
    action = next;
    $$('[data-assistant-action]').forEach(button => button.classList.toggle("is-active", button.dataset.assistantAction === next));
    $("#articleFields").hidden = next !== "article";
    $("#assistantBriefOptions").hidden = next !== "brief";
    const placeholders = { ask: "What would make today easier?", task: "Prepare the project update tomorrow at 9 @Work #deadline", reminder: "Remind me Friday at 3pm to follow up @Work #client", article: "Summarize, identify hidden connections and coach me", brief: "Choose a brief below or describe what you need" };
    $("#assistantInput").placeholder = placeholders[next];
  }

  function titleFromArticle(text, url) {
    const titleLine = String(text).match(/(?:^|\n)Title:\s*(.+)/i)?.[1]?.trim();
    if (titleLine) return titleLine.slice(0, 140);
    try { return new URL(url).hostname.replace(/^www\./, "") + " article"; } catch { return "Shared article"; }
  }

  async function readPublicArticle(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(`https://r.jina.ai/${url}`, { headers: { Accept: "text/plain" }, signal: controller.signal });
      if (!response.ok) throw new Error(`Reader returned ${response.status}`);
      return (await response.text()).slice(0, 700000);
    } finally { clearTimeout(timer); }
  }

  async function handleArticle() {
    const url = $("#articleUrlInput").value.trim();
    let text = $("#articleTextInput").value.trim();
    const instruction = $("#assistantInput").value.trim() || "Summarize the article, identify important points, hidden connections and useful next actions.";
    if (!text && !url) throw new Error("Paste an article URL or selected text first.");
    if (!text && url) {
      if (!state().publicReaderEnabled) throw new Error("Paste the article text, or enable Public article reader in Settings for non-confidential pages.");
      response("Reading the public page…");
      text = await readPublicArticle(url);
    }
    const doc = await app().saveTextSource({ name: titleFromArticle(text, url), text, type: "web", subject: "Reading", sourceUrl: url });
    response(`Saved “${doc.name}” to your encrypted Library. ${doc.summary}`);
    app().toast("Article saved. Ask Coach for synthesis or tasks.");
    app().navigate("coach");
    app().closeDialog($("#assistantDialog"));
    await app().sendCoach(`Using “${doc.name}” as the primary source, ${instruction}. Keep the summary concise, distinguish evidence from inference, and do not reproduce the full article.`);
  }

  async function submitAssistant(event) {
    event.preventDefault();
    const command = $("#assistantInput").value.trim();
    try {
      if (action === "article") { await handleArticle(); return; }
      if (action === "brief") { deliverBrief("morning"); return; }
      if (!command) { response("Tell me what you need first."); return; }
      if (handleTaskCommand(command)) return;
      if (action === "task" || action === "reminder") {
        const text = action === "reminder" && !/\bremind\b/i.test(command) ? `Remind me to ${command}` : command;
        const task = app().createTaskFromText(text, action === "reminder" ? "Assistant reminder" : "Assistant capture");
        const confirmation = `Added “${task.title}” under ${task.subject}${task.startAt ? ` for ${app().formatDue(task.startAt, true)}` : " in Inbox"}.`;
        response(confirmation); renderPlanner(); if (state().speakResponses) speak(confirmation); return;
      }
      app().closeDialog($("#assistantDialog"));
      app().navigate("coach");
      await app().sendCoach(command);
    } catch (error) { response(error.message || "Vidya could not complete that action."); }
  }

  async function downloadCalendar() {
    const tasks = openTasks().filter(task => task.startAt || task.dueAt);
    const stamp = date => new Date(date).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const clean = value => String(value || "").replace(/[\\;,\n]/g, match => `\\${match === "\n" ? "n" : match}`);
    const rows = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Vidya//Personal Planner//EN", "CALSCALE:GREGORIAN"];
    tasks.forEach(task => {
      const start = new Date(task.startAt || `${task.dueAt}T09:00:00`);
      const end = new Date(start.getTime() + (task.estimate || 25) * 60000);
      rows.push("BEGIN:VEVENT", `UID:${task.id}@vidya.local`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${clean(task.title)}`, `DESCRIPTION:${clean(`@${task.subject} ${(task.tags || []).map(tag => `#${tag}`).join(" ")}\n${task.notes || ""}`)}`);
      if (task.dueAt) rows.push(`DUE:${stamp(new Date(`${task.dueAt}T23:59:00`))}`);
      rows.push("END:VEVENT");
    });
    rows.push("END:VCALENDAR");
    const file = new File([rows.join("\r\n")], `vidya-plan-${localDay(new Date())}.ics`, { type: "text/calendar" });
    let delivered = false;
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "Vidya plan" }); delivered = true; }
      catch (error) { if (error?.name === "AbortError") { app().toast("Calendar sharing cancelled"); return; } }
    }
    if (!delivered) { const url = URL.createObjectURL(file); const link = document.createElement("a"); link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    app().toast("Calendar file is ready to add to Apple Calendar");
  }

  function setupCanvas() {
    const canvas = $("#scribeCanvas"); if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: false });
    const redraw = () => {
      context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.lineCap = "round"; context.lineJoin = "round"; context.strokeStyle = "#111827";
      strokes.forEach(stroke => {
        if (stroke.length < 2) return;
        context.beginPath(); context.moveTo(stroke[0].x, stroke[0].y);
        for (let index = 1; index < stroke.length; index += 1) { const point = stroke[index]; context.lineWidth = point.width; context.lineTo(point.x, point.y); context.stroke(); context.beginPath(); context.moveTo(point.x, point.y); }
      });
      $("#scribeEmpty").hidden = strokes.length > 0;
    };
    const point = event => { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height, width: 2.2 + Math.max(.2, event.pressure || .45) * 7 }; };
    canvas.addEventListener("pointerdown", event => { event.preventDefault(); canvas.setPointerCapture(event.pointerId); activeStroke = [point(event)]; strokes.push(activeStroke); redraw(); });
    canvas.addEventListener("pointermove", event => { if (!activeStroke) return; event.preventDefault(); activeStroke.push(point(event)); redraw(); });
    ["pointerup", "pointercancel", "pointerleave"].forEach(name => canvas.addEventListener(name, () => { activeStroke = null; }));
    $("#scribeUndo").addEventListener("click", () => { strokes.pop(); redraw(); });
    $("#scribeClear").addEventListener("click", () => { strokes = []; redraw(); });
    redraw();
  }

  function currentVisual() {
    if (scribeMode === "scan" && visualData) return visualData;
    if (scribeMode === "sketch" && strokes.length) return $("#scribeCanvas").toDataURL("image/png");
    return "";
  }

  function setScribeMode(mode) {
    scribeMode = ["write", "scan", "sketch"].includes(mode) ? mode : "write";
    $$('[data-scribe-mode]').forEach(button => { const active = button.dataset.scribeMode === scribeMode; button.classList.toggle("is-active", active); button.setAttribute("aria-pressed", String(active)); });
    $$('[data-scribe-panel]').forEach(panel => { panel.hidden = panel.dataset.scribePanel !== scribeMode; });
    const hints = { write: "Write and save locally without AI. Ask Vidya to turn the note into the selected outcome.", scan: "Photos save locally. Reading or interpreting the image requires the connected engine.", sketch: "Drawing saves locally. Understanding the sketch requires the connected engine." };
    $("#scribeStatus").textContent = hints[scribeMode];
  }

  function setScribeOutcome(outcome) {
    scribeOutcome = ["tasks", "summary", "explain", "plan"].includes(outcome) ? outcome : "tasks";
    $$('[data-scribe-outcome]').forEach(button => { const active = button.dataset.scribeOutcome === scribeOutcome; button.classList.toggle("is-active", active); button.setAttribute("aria-pressed", String(active)); });
  }

  function scribeInstruction() {
    const goal = {
      tasks: "Extract proposed tasks with owners, deadlines, dependencies and uncertainty. Let me review them; do not claim they were created.",
      summary: "Give a concise summary, the important points, conclusion and what is good to know.",
      explain: "Explain this clearly from first principles, distinguish visible evidence from inference, and ask one coaching question.",
      plan: "Turn this into a practical action plan with the first step, sequence, risks and checkpoints."
    }[scribeOutcome];
    const extra = $("#visualPromptInput").value.trim();
    return `${goal}${extra ? ` Additional focus: ${extra}` : ""}`;
  }

  function resetScribe() {
    $("#scribeTextInput").value = ""; $("#visualPromptInput").value = ""; $("#visualFileInput").value = "";
    visualData = ""; strokes = []; $("#visualPreview").hidden = true;
    const canvas = $("#scribeCanvas"); const context = canvas?.getContext("2d", { alpha: false });
    if (context) { context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height); }
    $("#scribeEmpty").hidden = false; setScribeMode("write"); setScribeOutcome("tasks");
  }

  async function saveScribe({ quiet = false, keepOpen = false } = {}) {
    const written = $("#scribeTextInput").value.trim();
    const context = $("#visualPromptInput").value.trim();
    const image = currentVisual();
    const note = scribeMode === "write" ? written : context;
    if (!note && !image) { app().toast(scribeMode === "scan" ? "Choose a photo first" : "Write or draw something first"); return null; }
    const label = scribeMode === "write" ? "Scribe note" : scribeMode === "scan" ? "Scanned visual" : "Sketch";
    const doc = await app().saveTextSource({ name: `${label} · ${new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date())}`, text: note || `${label} saved for later interpretation.`, type: image ? "visual" : "note", subject: "Inbox", imageData: image });
    if (!quiet) app().toast(`${label} saved in Library → @Inbox`);
    $("#scribeStatus").textContent = `Saved as “${doc.name}” in Library → @Inbox.`;
    if (!keepOpen) { resetScribe(); app().closeDialog($("#scribeDialog")); }
    return doc;
  }

  async function interpretScribe() {
    const note = $("#scribeTextInput").value.trim();
    const image = currentVisual();
    const prompt = scribeInstruction();
    if (!image && !note) { app().toast(scribeMode === "scan" ? "Choose a photo first" : "Write or draw something first"); return; }
    try {
      $("#interpretVisual").disabled = true; $("#interpretVisual").textContent = "Interpreting…";
      await saveScribe({ quiet: true, keepOpen: true });
      $("#scribeStatus").textContent = `Original saved in Library → @Inbox. ${image ? "Analyzing with the connected engine…" : "Sending the editable note to Coach…"}`;
      if (!image) { app().closeDialog($("#scribeDialog")); app().navigate("coach"); resetScribe(); await app().sendCoach(`${prompt}\n\nCAPTURED NOTE:\n${note}`); return; }
      const answer = await app().analyzeVisual(image, `${prompt}\nUser context: ${note || $("#visualPromptInput").value.trim() || "None"}`);
      lastResponse = answer;
      app().addChat({ role: "ai", html: app().textToHtml(answer), meta: `Vidya · visual intelligence · ${app().hasSecureEngine?.() ? "secure engine" : "experimental Gemini"}` });
      app().closeDialog($("#scribeDialog")); resetScribe(); app().navigate("coach"); if (state().speakResponses) speak(answer);
    } catch (error) { app().toast(error.message); }
    finally { $("#interpretVisual").disabled = false; $("#interpretVisual").textContent = "Ask Vidya"; }
  }

  async function copyShortcut(kind) {
    const base = `${location.origin}${location.pathname}`;
    const templates = {
      capture: `${base}#action=task&text=[URL-Encoded Dictated Text]`,
      article: `${base}#action=article&url=[URL-Encoded Shortcut Input]`,
      brief: `${base}#action=brief&kind=morning`
    };
    try { await navigator.clipboard.writeText(templates[kind]); app().toast("Shortcut URL template copied"); }
    catch { prompt("Copy this Shortcut URL template:", templates[kind]); }
  }

  function handleFragment() {
    const raw = location.hash.replace(/^#\/?/, ""); if (!raw) return;
    const params = new URLSearchParams(raw); const intent = params.get("action");
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    if (intent === "task") {
      const text = params.get("text") || "";
      if (text) { const task = app().createTaskFromText(text, "Siri Shortcut"); app().navigate("today"); const confirmation = `Added ${task.title}${task.startAt ? ` for ${app().formatDue(task.startAt, true)}` : " to Inbox"}.`; app().toast(confirmation); if (state().speakResponses) speak(confirmation); }
      else { setAssistantAction("task"); app().openDialog("assistantDialog"); }
    }
    if (intent === "article") { setAssistantAction("article"); $("#articleUrlInput").value = params.get("url") || ""; $("#articleTextInput").value = params.get("text") || ""; app().openDialog("assistantDialog"); }
    if (intent === "ask") { setAssistantAction("ask"); $("#assistantInput").value = params.get("text") || ""; app().openDialog("assistantDialog"); }
    if (intent === "brief") deliverBrief(params.get("kind") || "morning");
    if (intent === "reminder") {
      const task = state().tasks.find(item => item.id === params.get("task"));
      app().navigate("today");
      if (task) { app().openTaskDialog(task); if (state().speakResponses) speak(`Reminder: ${task.title}`); }
      else app().toast("The reminder is no longer in your open list");
    }
  }

  function wire() {
    $("#activateVidyaButton").addEventListener("click", () => { setAssistantAction("ask"); app().openDialog("assistantDialog"); });
    $("#assistantActions").addEventListener("click", event => { const button = event.target.closest("[data-assistant-action]"); if (button) setAssistantAction(button.dataset.assistantAction); });
    $("#assistantForm").addEventListener("submit", submitAssistant);
    $("#assistantVoiceButton").addEventListener("click", () => startRecognition($("#assistantInput"), true));
    $("#quickCaptureVoice").addEventListener("click", () => startRecognition($("#quickCaptureInput"), false));
    $("#quickCaptureScribe").addEventListener("click", () => app().openDialog("scribeDialog"));
    $("#openScribeButton").addEventListener("click", () => { app().closeDialog($("#assistantDialog")); app().openDialog("scribeDialog"); setTimeout(() => $("#scribeTextInput").focus(), 120); });
    $("#quickCaptureInput").addEventListener("input", event => previewCapture(event.target.value));
    $("#quickCaptureForm").addEventListener("submit", event => { event.preventDefault(); const input = $("#quickCaptureInput"); if (!input.value.trim()) return; const task = app().createTaskFromText(input.value, "Today quick capture"); input.value = ""; previewCapture(""); renderPlanner(); app().toast(`Added “${task.title}”`); });
    $("#weekStrip").addEventListener("click", event => { const button = event.target.closest("[data-planner-date]"); if (!button) return; state().plannerDate = button.dataset.plannerDate; app().saveState(); renderPlanner(); });
    document.addEventListener("click", event => { const button = event.target.closest("[data-planner-task]"); if (button) app().openTaskDialog(state().tasks.find(task => task.id === button.dataset.plannerTask)); });
    $("#morningBriefButton").addEventListener("click", () => deliverBrief("morning"));
    $("#tomorrowBriefButton").addEventListener("click", () => deliverBrief("tomorrow"));
    $("#runCommandBrief").addEventListener("click", () => generateCommandBrief("manual"));
    $("#runScheduledBriefTest").addEventListener("click", () => generateCommandBrief("manual"));
    $("#commandBriefSchedule").addEventListener("click", () => { app().openDialog("settingsDialog"); setTimeout(() => $("#scheduledBriefSection")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120); });
    $("#assistantBriefOptions").addEventListener("click", event => { const button = event.target.closest("[data-brief-kind]"); if (button) deliverBrief(button.dataset.briefKind); });
    $("#speakLastResponse").addEventListener("click", () => speak(lastResponse || $("#assistantResponse").textContent));
    $("#exportCalendarButton").addEventListener("click", downloadCalendar);
    $("#openShortcutsSetup").addEventListener("click", () => { app().closeDialog($("#settingsDialog")); app().openDialog("shortcutsDialog"); });
    $("#openAssistantFromSettings").addEventListener("click", () => { app().closeDialog($("#settingsDialog")); app().openDialog("assistantDialog"); });
    $("#shortcutsDialog").addEventListener("click", event => { const button = event.target.closest("[data-copy-shortcut]"); if (button) copyShortcut(button.dataset.copyShortcut); });
    $("#scribeModeTabs").addEventListener("click", event => { const button = event.target.closest("[data-scribe-mode]"); if (button) setScribeMode(button.dataset.scribeMode); });
    $("#scribeOutcomeButtons").addEventListener("click", event => { const button = event.target.closest("[data-scribe-outcome]"); if (button) setScribeOutcome(button.dataset.scribeOutcome); });
    $("#saveScribeNote").addEventListener("click", () => saveScribe());
    $("#interpretVisual").addEventListener("click", interpretScribe);
    $("#visualFileInput").addEventListener("change", event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 12 * 1024 * 1024) { app().toast("Choose an image under 12 MB"); return; } const reader = new FileReader(); reader.onload = () => { visualData = String(reader.result); $("#visualPreview").src = visualData; $("#visualPreview").hidden = false; $("#scribeStatus").textContent = "Photo ready. Save it locally or Ask Vidya for the selected outcome."; }; reader.readAsDataURL(file); });
    $("#readSourceButton").addEventListener("click", () => { const title = $("#sourceDialogTitle").textContent; const summary = $("#sourceDialogBody .source-summary p")?.textContent || ""; speak(`${title}. ${summary}`); });
    $("#readStoryButton").addEventListener("click", () => speak($("#storyDialog").textContent.replace(/Read aloud|Create action|Open source|Ask Coach/g, " ")));
    $("#taskDialog").addEventListener("click", event => { const button = event.target.closest("[data-task-preset]"); if (!button) return; const input = $("#taskDueInput"); if (button.dataset.taskPreset === "clear") { input.value = ""; return; } const date = new Date(); if (button.dataset.taskPreset === "tomorrow") date.setDate(date.getDate() + 1); if (button.dataset.taskPreset === "week") date.setDate(date.getDate() + 7); date.setHours(button.dataset.taskPreset === "today" ? Math.max(9, date.getHours() + 1) : 9, 0, 0, 0); const offset = date.getTimezoneOffset() * 60000; input.value = new Date(date - offset).toISOString().slice(0, 16); });
    window.addEventListener("vidya-response", event => { lastResponse = event.detail.text || ""; response(lastResponse, event.detail.html || ""); if (state()?.speakResponses) speak(lastResponse); });
    window.addEventListener("vidya-statechange", () => { if (state()) { renderPlanner(); renderCommandBrief(); } });
    window.addEventListener("hashchange", handleFragment);
    setupCanvas(); setScribeMode("write"); setScribeOutcome("tasks"); renderPlanner(); renderCommandBrief(); handleFragment(); syncLatestBrief();
  }

  window.addEventListener("vidya-ready", wire, { once: true });
})();
