# Test Instructions — Antigravity Chat App
> Read top-to-bottom. Each section is a self-contained test group.
> ✅ = Expected pass | ❌ = Expected failure/rejection | 🔍 = What to look for

---

## Pre-Flight: Starting the Application

### Terminal 1 — Server
```
cd chat-app/server
npm run dev
```
Expected output: `Server listening on port 4000` — no red errors.

### Terminal 2 — Client
```
cd chat-app/client
npm run dev
```
Expected output: `Local: http://localhost:5173/`

Open **two separate browser profiles** (or two incognito windows) side by side.
- **Window A** = User A (main tester)
- **Window B** = User B (the other participant)

---

## TEST GROUP 1 — Authentication

### 1.1 Registration — User A

1. Open `http://localhost:5173` in **Window A**.
2. You should be redirected to `/register`.
3. Fill in: `username`, `email`, and `password` (min 8 chars).
4. Click **Register**.

✅ **Expected:** Automatically redirected to the main chat dashboard.
✅ **Expected:** Sidebar shows the username and email in the user info row.
❌ **Reject case:** Try registering with the same email again → should show an error.
❌ **Reject case:** Try a password shorter than 8 characters → form should refuse to submit.

---

### 1.2 Registration — User B

1. Open `http://localhost:5173` in **Window B**.
2. Register a **different** username and email from User A.

✅ **Expected:** Redirected to dashboard.

---

### 1.3 Login

1. Log out of User A (click "Log out" in the sidebar footer).
2. You are redirected to `/login`.
3. Enter correct credentials.

✅ **Expected:** Redirected back to dashboard.
❌ **Reject case:** Enter wrong password → should show a login error.

---

### 1.4 Session Persistence

1. While logged in as User A, hard-refresh the page (`Ctrl+Shift+R`).

✅ **Expected:** You remain on the dashboard — NOT redirected to login.
🔍 **Look for:** A brief loading spinner while the refresh token silently refreshes the access token, then the UI loads.

---

### 1.5 Route Guard

1. Log out. You're on `/login`.
2. Manually type `http://localhost:5173/` in the address bar and press Enter.

✅ **Expected:** Instantly redirected to `/login` — the dashboard is protected.

---

## TEST GROUP 2 — Creating Conversations

### 2.1 Start a Direct Message

1. In **Window A** (User A), click **"New Conversation"** in the sidebar.
2. The "New Conversation" modal opens.
3. In the search box, type the **username of User B**.

✅ **Expected:** User B appears in the results list with their avatar and email.

4. Click on User B to select them (a checkmark should appear).
5. Click **"Start Chat"**.

✅ **Expected:** Modal closes. The DM room appears in User A's sidebar. The chat window opens with User B's name in the header.
✅ **Expected:** In **Window B** (User B), the same DM room automatically appears in their sidebar — **no page refresh needed**.

---

### 2.2 Start a Group Chat

1. In **Window A**, click **"New Conversation"** again.
2. Search for and select **two or more users** (User B, plus any others).

🔍 **Look for:** A "Group Name (Optional)" text field that appears once 2+ users are selected.

3. Optionally enter a group name like `Test Group`.
4. Click **"Create Group"**.

✅ **Expected:** Group room appears in the sidebar with a member count in the header (e.g., `3 members`).

---

## TEST GROUP 3 — Real-Time Messaging

> ⚠️ Keep **Window A** and **Window B** side by side for all tests in this group.

### 3.1 Send and Receive Messages

1. In **Window A**, click into the DM with User B.
2. Type a message: `"Hello from User A!"` and press **Enter** or click Send.

✅ **Expected (Window A):** Message appears instantly in a violet bubble on the right side.
✅ **Expected (Window B):** The exact same message appears instantly in a dark bubble on the left side — **no page refresh**.

3. In **Window B**, reply: `"Hey User A!"`.

✅ **Expected:** User A sees User B's reply instantly.

---

### 3.2 Typing Indicator

1. In **Window A**, start typing in the message input (don't send).

✅ **Expected (Window B):** A typing indicator appears below the message list showing `"User A is typing..."` with 3 animated dots.

2. Stop typing (don't press send). Wait ~3 seconds.

✅ **Expected (Window B):** The typing indicator **disappears automatically** after about 3 seconds.

3. In **Window A**, type something and **send** it immediately.

✅ **Expected (Window B):** The typing indicator disappears the moment the message arrives.

---

### 3.3 Online Presence

1. In **Window B**, look at the DM header where User A's name is shown.

✅ **Expected:** A green "online" badge/text is visible under User A's name.

2. Close **Window A** entirely (close the tab).
3. Wait ~30 seconds.

✅ **Expected:** The "online" badge on Window B changes to "offline".

4. Reopen `http://localhost:5173` in **Window A** and log back in.

✅ **Expected:** The "online" status returns in **Window B**.

---

### 3.4 Unread Badge

1. In **Window B**, click away to another room (or just don't have the DM active).
2. In **Window A**, send 3 messages to User B.

✅ **Expected (Window B):** The DM room item in the sidebar shows an unread count badge (e.g., **3**).

3. In **Window B**, click on the DM room.

✅ **Expected:** The unread badge disappears immediately.

---

### 3.5 Message Replay on Reconnect

1. Close **Window B** entirely.
2. In **Window A**, send 2-3 messages.
3. Reopen **Window B** and log in again.

✅ **Expected:** All messages sent while Window B was offline appear correctly in the chat window — they are replayed in the correct order.

---

## TEST GROUP 4 — Message Actions

### 4.1 Edit a Message

1. In **Window A**, hover over one of your own messages.
2. A `⋮` (three-dot) icon should appear to the left of the bubble.
3. Click it → a dropdown appears with **"Edit"** and **"Delete"**.
4. Click **Edit**.

✅ **Expected:** The message input banner changes to show "Editing message: ..." with a "Cancel" button. The original text is pre-filled in the textarea.

5. Change the text and press **Enter** to save.

✅ **Expected (Window A):** The message bubble updates to the new text. A small grey "edited" label appears below it.
✅ **Expected (Window B):** The message updates in real-time without a page refresh.

---

### 4.2 Delete a Message

1. Hover over one of your own messages and click `⋮`.
2. Click **Delete**.
3. A browser confirmation dialog: "Are you sure you want to delete this message?" — click OK.

✅ **Expected (Window A):** The message bubble is replaced with a grey dashed "Message deleted" placeholder.
✅ **Expected (Window B):** Same — the message placeholder appears in real-time.
❌ **Reject case:** You should NOT see an Edit or Delete option on messages sent by the OTHER user.

---

### 4.3 Cancel Edit

1. Start editing a message (hover → `⋮` → Edit).
2. Click the **Cancel** button in the editing banner.

✅ **Expected:** The input clears, the editing banner disappears, and the original message is unchanged.

---

## TEST GROUP 5 — File Uploads

### 5.1 Upload an Image

1. In **Window A**, click the **paperclip / attach** icon in the message input.
2. Select a valid `.jpg`, `.png`, or `.webp` image file from your computer.

✅ **Expected:** A loading spinner appears in the attach button while uploading.
✅ **Expected:** The image appears as an inline preview in the chat for both User A and User B.
✅ **Expected (Window B):** Image appears in real-time.

---

### 5.2 Click Image to Open Full-Size

1. Click on the image that was uploaded.

✅ **Expected:** The full-size image opens in a new browser tab (ImageKit URL).

---

### 5.3 Upload a PDF / Document

1. Click the paperclip icon again. Select a `.pdf` file.

✅ **Expected:** A file "card" appears in the chat showing the filename, file size, and a download icon.
✅ **Expected:** Clicking the download icon starts a file download.

---

### 5.4 Reject Invalid File Type

1. Click the paperclip icon. Try to select a `.exe`, `.zip`, or `.js` file.

❌ **Expected:** The file picker should not allow selecting it (the `accept` attribute filters them out). If the OS allows it, the upload should fail with an error.

---

### 5.5 Reject Oversized File

1. Try uploading any file larger than **25 MB**.

❌ **Expected:** An alert: "File size exceeds the 25MB limit." — No upload request is made.

---

## TEST GROUP 6 — AI Features

> These tests require at least a few messages to have been sent in the room.

### 6.1 AI Assistant (Streaming Chat)

1. Look for the **Sparkles / AI** button in the chat window header.
2. Click it to open the **AI Co-pilot sidebar** on the right.

✅ **Expected:** A slide-in panel appears with a greeting message from the AI.

3. Type a question: `"Summarize our conversation so far."` and press Enter.

✅ **Expected:** The AI response streams in **word-by-word** in real-time.
✅ **Expected:** A **"Stop Generating"** button appears at the top of the input while the response streams.
4. Click **Stop Generating** while it's streaming.

✅ **Expected:** Streaming stops immediately.

5. Test multi-turn: ask a follow-up question like `"What did you just say?"`.

✅ **Expected:** The AI remembers the previous turn and responds contextually.

6. Click the trash icon to **Clear History**.

✅ **Expected:** A confirmation dialog appears. Confirm → the conversation resets to just the initial greeting.

7. Click **X** to close the sidebar.

✅ **Expected:** The sidebar slides out / disappears.

---

### 6.2 Conversation Summarizer (Streaming Modal)

1. In the chat header, look for a **Summarize** button (or a bookmark/summary icon).
2. Click it.

✅ **Expected:** A full-screen modal appears with "Conversation Summary" in the header.
✅ **Expected:** A spinner shows "Analyzing conversation thread..." then the summary streams in word-by-word.
✅ **Expected:** Markdown formatting (bold, bullets) renders correctly.

3. Once complete, click **Copy Summary**.

✅ **Expected:** The button briefly changes to "✓ Copied".

4. Click the backdrop (the dark area outside the modal) to close it.

✅ **Expected:** Modal closes.

5. Reopen the modal.

✅ **Expected:** It fetches a fresh summary and streams again.

---

## TEST GROUP 7 — Edge Cases & Stability

### 7.1 Send Empty Message

1. Click in the message input and press Enter without typing anything.

❌ **Expected:** Nothing happens. No empty message is sent.

---

### 7.2 Long Messages

1. Paste a very long paragraph (500+ characters) into the input.

✅ **Expected:** The textarea **auto-expands** vertically up to a maximum height, then becomes scrollable.
✅ **Expected:** The message sends and renders correctly in the bubble with word-wrap.

---

### 7.3 Multiline Messages

1. In the message input, press **Shift+Enter** to add a new line.
2. Type more text below. Press **Enter** to send.

✅ **Expected:** The message renders with correct line breaks in the bubble.
❌ **Reject case:** Pressing plain Enter (without Shift) should send — not add a new line.

---

### 7.4 XSS Injection Safety

1. In the message input, type the following and send it:
   ```
   <script>alert('XSS')</script>
   ```

❌ **Expected:** NO browser alert popup. The text should render as a literal string (or be stripped), never executed. (This is the DOMPurify sanitization working correctly.)

---

### 7.5 Switching Rooms

1. Open two different rooms in the sidebar quickly.

✅ **Expected:** The chat window updates correctly for each room, with the right messages and the right other user's name in the header.
✅ **Expected:** Typing indicator and presence data resets for the newly selected room.

---

### 7.6 Logout & Session Termination

1. Log out from User A.

✅ **Expected:** Redirected to `/login`.
✅ **Expected:** Navigating back to `/` redirects to `/login`.
✅ **Expected:** Socket disconnects (check server terminal — no more heartbeat events from User A).

---

## TEST GROUP 8 — UI / Visual Polish

### 8.1 Loading Skeletons

1. Log out. Log back in.

🔍 **Look for:** The sidebar shows animated skeleton loaders (pulsing grey boxes) while rooms are being fetched, before the list appears.

---

### 8.2 Empty State

1. Log in as a brand new user who has no conversations yet.

✅ **Expected:** The sidebar shows a centered "No conversations yet" message.
✅ **Expected:** The main content area shows an empty/welcome state (no crashes).

---

### 8.3 Responsive Layout (Mobile View)

1. Open DevTools (F12) → toggle device toolbar → select a mobile size (e.g., iPhone 14, 390x844).
2. Load the app.

✅ **Expected:** Only the sidebar is shown on mobile (full width).
✅ **Expected:** Clicking a room shows the chat window (the sidebar hides).
✅ **Expected:** A back arrow (←) button appears in the chat header to return to the sidebar.

---

## Summary Checklist

| # | Test | Status |
|---|------|--------|
| 1.1 | Register User A | ⬜ |
| 1.2 | Register User B | ⬜ |
| 1.3 | Login | ⬜ |
| 1.4 | Session persistence (hard refresh) | ⬜ |
| 1.5 | Route guard | ⬜ |
| 2.1 | Start DM | ⬜ |
| 2.2 | Create group chat | ⬜ |
| 3.1 | Send & receive messages | ⬜ |
| 3.2 | Typing indicator appears & auto-clears | ⬜ |
| 3.3 | Online presence | ⬜ |
| 3.4 | Unread badge | ⬜ |
| 3.5 | Message replay after reconnect | ⬜ |
| 4.1 | Edit message | ⬜ |
| 4.2 | Delete message | ⬜ |
| 4.3 | Cancel edit | ⬜ |
| 5.1 | Upload image | ⬜ |
| 5.2 | Click image for full-size | ⬜ |
| 5.3 | Upload PDF | ⬜ |
| 5.4 | Reject invalid file type | ⬜ |
| 5.5 | Reject oversized file | ⬜ |
| 6.1 | AI Assistant streaming | ⬜ |
| 6.2 | Summarizer streaming | ⬜ |
| 7.1 | Empty message rejected | ⬜ |
| 7.2 | Long messages | ⬜ |
| 7.3 | Multiline with Shift+Enter | ⬜ |
| 7.4 | XSS injection rejected | ⬜ |
| 7.5 | Room switching | ⬜ |
| 7.6 | Logout & session termination | ⬜ |
| 8.1 | Loading skeletons | ⬜ |
| 8.2 | Empty state | ⬜ |
| 8.3 | Mobile responsive layout | ⬜ |

---

> **When you find a bug:** Note the test number, what you expected, and what actually happened. Share it with me and I'll fix it immediately.
