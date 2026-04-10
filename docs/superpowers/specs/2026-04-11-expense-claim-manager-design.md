# Expense Claim Manager — Design Spec

## Overview

A PWA web app for managing household and business expense claims across multiple projects. Two users (Leonard and wife) each use the app on their own Android phone to capture receipts and log expenses. Data auto-syncs to a shared Google Spreadsheet. Receipts are uploaded to Google Drive with standardized naming.

## Problem

Leonard's wife manages expenses across multiple business projects (party rooms, subdivided flats, etc.). She buys things on behalf of each project using various payment methods, then has to manually reconcile and claim back the money each month. This takes days of manual work.

## Users

- **Leonard** — uses on his Android phone
- **Wife** — primary user, uses on her Android phone
- Each phone has its own identity (set once on first launch), no shared login system

## Architecture

```
[Android Phone — PWA]
    ├── Camera / Text Input
    ├── Gemini 2.0 Flash API (client-side) → OCR receipt extraction
    ├── IndexedDB (local storage, offline-capable)
    ├── Google Apps Script → auto-sync to Google Sheets
    └── Google Drive API → upload receipt photos
```

- **Frontend:** HTML / CSS / JS — same stack as salary-calculator
- **OCR:** Gemini 2.0 Flash API, called client-side
- **Local Storage:** IndexedDB (offline-first, syncs when online)
- **Cloud Storage:** Google Sheets (data) + Google Drive (receipt photos)
- **Hosting:** GitHub Pages
- **Cost:** Free (Gemini free tier, GitHub Pages free, Google Apps Script free)

## Data Model

Each expense record contains:

| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Auto-generated |
| project | string | Selected from project list |
| amount | number | Extracted by AI or manual input |
| currency | enum | HKD (default) / RMB |
| description | string | What was purchased |
| paymentDate | date | When the payment was made |
| paymentMethod | enum | Cash / Credit Card / Taobao / Pinduoduo / FPS / Alipay / Other |
| paidBy | string | Auto-filled from device identity |
| claimStatus | enum | unclaimed / claimed |
| claimDate | date | null until marked as claimed |
| receiptPhoto | string | Google Drive link (optional) |
| createdAt | timestamp | Auto-generated |
| syncedAt | timestamp | null until synced to Sheets |

## Projects

- Dynamic list, user can add/edit projects
- Each project has: name, color (theme color for UI differentiation)
- Default projects: "Partyland MK", "Fancy Free BBQ Party Room"
- Project colors are used throughout: dashboard cards, record list tags, headers

## User Identity

- First launch: enter name + set 4-digit passcode
- Stored in localStorage, remembered on that device
- Passcode is for preventing accidental wrong-user entry, not security
- The `paidBy` field auto-fills based on device identity

## Core User Flow

### Adding an Expense

```
Select project (color-coded buttons)
    ↓
Choose input method: 📷 Photo  |  ✏️ Text
    ↓
[Photo] → Camera capture → Send to Gemini Flash → Extract: amount, date, description, currency
[Text] → Manual input (supports shorthand like "五金鋪雜項 $46")
    ↓
AI shows extracted data → User confirms or corrects
If AI is uncertain about any field → Highlights field + asks user to confirm/fill in
    ↓
Duplicate detection check (see below)
    ↓
Fill remaining fields: payment method (dropdown), date (default today)
    ↓
Save → IndexedDB + auto-sync to Google Sheets + upload photo to Google Drive
```

### Marking Claims

- Record list view → select records → "Mark as Claimed" button
- Supports bulk claim (select all unclaimed for a project/month)
- Sets claimStatus = "claimed" and claimDate = today
- Syncs updated status to Google Sheets

## Duplicate Detection

When adding a new record, check IndexedDB for potential duplicates:

**Match criteria (ALL must match):**
- Same project
- Amount within ±10%
- Date within 3 days

**If match found:**
- Show warning with the suspected duplicate record details
- User chooses: "Not a duplicate — save anyway" or "Yes duplicate — cancel"

## AI Smart Assistant (Gemini Flash)

The AI is not just an OCR tool — it acts as a conversational assistant that helps the user verify and complete each expense entry. It proactively asks clarifying questions when something is unclear, ambiguous, or unusual.

**Input:** Photo of receipt / screenshot (Taobao, FPS confirmation, credit card statement, etc.) or text input.

**Prompt strategy:**
- Send image to Gemini 2.0 Flash with structured extraction prompt
- Request JSON output: `{ amount, currency, date, description, confidence, questions[] }`
- AI returns both extracted data AND any follow-up questions it has
- Support Chinese (Traditional + Simplified) and English receipts

**API call:** Client-side fetch to `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`

### AI Clarification Scenarios

**Photo quality issues:**
- Blurry / glare / cropped → "張相有啲唔清楚，我睇到 $4X，係咪 $46？"
- Cannot find amount → "我搵唔到金額，可唔可以打返個數？"

**Multi-item receipts:**
- Multiple items on one receipt → "呢張單有 3 件嘢共 $138，你想逐件分開入定合埋一筆？"
- Receipt has discount / shipping → "原價 $100，折後 $78，運費 $12，你想入 $78 定 $90（連運費）？"

**Currency detection:**
- Taobao/Pinduoduo screenshot → Auto-suggest RMB: "呢張淘寶單應該係人民幣 ¥46，唔係港紙，啱唔啱？"
- Ambiguous currency → "呢張單冇寫明貨幣，係港紙定人民幣？"

**Date anomalies:**
- Date far from today → "呢張單日期係 3月15號，係咪之前漏咗入？"
- No date on receipt → "張單冇日期，用今日 4月11號得唔得？"

**Abnormal amounts:**
- Unusually large for the project → "呢筆 $4,600 比平時呢個項目大好多，確認啱嘅？要唔要即 claim？"

**Smart suggestions (learning from history):**
- Recognizes store name → Auto-suggest project: "五金鋪雜項你之前都係入 Partyland MK，今次都係？"
- Recognizes platform → Auto-fill payment method: Taobao screenshot → payment method = 淘寶, currency = RMB
- Frequent merchant → Pre-fill description based on past entries

### AI Conversation UI

- After AI extraction, results shown in a chat-like interface (not just a form)
- AI message: "我睇到呢張單係..." with extracted details
- If AI has questions: shown as follow-up bubbles the user can tap to answer
- User can correct any field by tapping on it
- Once all fields confirmed → "OK！已經入好喇 ✓" → save

## Google Sheets Integration

**Structure:**
- One spreadsheet (shared between both users)
- Each month = new tab (e.g., "2026-04")
- Columns: Date | Project | Description | Amount | Currency | Payment Method | Paid By | Claim Status | Receipt Link
- Auto-generated subtotals per project at bottom of each tab
- Grand total row at the very bottom

**Sync mechanism:**
- Google Apps Script deployed as web app (same pattern as salary-calculator)
- Each new record triggers a POST to the Apps Script endpoint
- Apps Script finds/creates the month tab and appends the row
- Claim status updates also sync via the same endpoint

## Google Drive Integration

**Receipt photo upload:**
- Upload to a designated Google Drive folder
- File naming: `{YYYY-MM-DD}_{project}_{amount}_{currency}.jpg`
- The Google Drive link is stored in the record and included in the Sheets row
- Implemented via Google Apps Script (receives base64 image, saves to Drive, returns link)

## App Pages

### 1. Dashboard (Home)
- Project cards with color coding
- Each card shows: project name, current month total (unclaimed), number of records
- Total unclaimed amount across all projects
- Quick-add button (floating action button)

### 2. Add Expense
- Project selector (color-coded)
- Photo capture / text input toggle
- AI extraction result display with editable fields
- Payment method dropdown
- Duplicate warning overlay

### 3. Record List
- Filter by: month, project, claim status, paid by
- Each record shows: date, description, amount (in project color), claim status badge
- Tap to view details / edit
- Multi-select for bulk claim
- Swipe or long-press for delete

### 4. Project Management
- List of projects with color swatches
- Add new project (name + pick color)
- Edit existing project
- Cannot delete project with records (archive instead)

### 5. Settings
- User name and passcode
- Google Sheets link configuration
- Gemini API key input
- Export options

## Payment Methods

Fixed list (can be extended in settings):
- Cash (現金)
- Credit Card (信用卡)
- Taobao (淘寶)
- Pinduoduo (拼多多)
- FPS (轉數快)
- Alipay (支付寶)
- Other (其他)

## Offline Support

- Service worker caches app shell
- Records saved to IndexedDB immediately (works offline)
- Sync queue: when back online, pending records auto-sync to Sheets
- Photo upload queued until online

## UI/UX Notes

- Language: Traditional Chinese (Cantonese style)
- Project colors: distinct, accessible colors for each project
- Mobile-first responsive design (primarily used on Android phones)
- Dark mode: optional, follow system preference
- Currency toggle: HKD/RMB, default HKD
