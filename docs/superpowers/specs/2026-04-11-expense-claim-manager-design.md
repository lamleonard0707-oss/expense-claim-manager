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

## AI Receipt Recognition (Gemini Flash)

**Input:** Photo of receipt / screenshot (Taobao, FPS confirmation, credit card statement, etc.)

**Prompt strategy:**
- Send image to Gemini 2.0 Flash with structured extraction prompt
- Request JSON output: `{ amount, currency, date, description, confidence }`
- If confidence < 0.8 on any field → highlight that field for user confirmation
- If amount not found → ask user to input manually
- Support Chinese (Traditional + Simplified) and English receipts

**API call:** Client-side fetch to `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`

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
