# eVoting System Pro 🗳️

> Secure · Transparent · Precise

[![Live App](https://img.shields.io/badge/Live%20App-evotingsystempro.expo.app-4F46E5?style=for-the-badge)](https://evotingsystempro.expo.app)
[![GitHub](https://img.shields.io/badge/GitHub-evotingsystempro-181717?style=for-the-badge&logo=github)](https://github.com/stanleyafon6/evotingsystempro)
[![Watch Demo](https://img.shields.io/badge/Watch%20Demo-Tutorial%20Video-EA4335?style=for-the-badge&logo=youtube&logoColor=white)](https://firebasestorage.googleapis.com/v0/b/evotingsystempro-788f7.firebasestorage.app/o/eVoting_System_Pro%2FeVotingSystemPro-Screen-Videos%2FOPENAIBUILDWEEK.mp4?alt=media&token=c3431ee6-b1de-4b50-8486-1580bf72ff95)

---

## Project Overview

**eVoting System Pro** is a digital voting platform built with **React Native (Expo)** and **Firebase**. It enables organizers to create and run secure, verifiable polls and elections — from single-choice leadership votes to multi-candidate committee elections — with real-time results and built-in fraud prevention.

**Quick links:**

| Resource      | Link                                                                                                                                                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🌐 Live App   | [evotingsystempro.expo.app](https://evotingsystempro.expo.app)                                                                                                                                                                                      |
| 💻 GitHub     | [github.com/stanleyafon6/evotingsystempro](https://github.com/evotingsystempro)                                                                                                                                                                     |
| 🎥 Demo Video | [Watch the tutorial video](https://firebasestorage.googleapis.com/v0/b/evotingsystempro-788f7.firebasestorage.app/o/eVoting_System_Pro%2FeVotingSystemPro-Screen-Videos%2FOPENAIBUILDWEEK.mp4?alt=media&token=c3431ee6-b1de-4b50-8486-1580bf72ff95) |

---

## 🤖 Built With Codex & GPT-5.6

This project was built in collaboration with **OpenAI Codex** and uses **GPT-5.6** as a live, in-app feature — not just a development aid.

### How Codex was used

Codex assisted throughout the build — scaffolding components, refactoring the voter file parsing logic, and helping debug edge cases in the CSV/Excel import flow. Key product and architecture decisions (the flat Firestore schema, the positional column-1/column-2 convention for voter files, the fraud-prevention approach) were made by the project owner, with Codex accelerating implementation and surfacing edge cases along the way.

**Codex session used for this submission:** `019f81ac-ca72-7322-acbe-7b1266d18799`

### How GPT-5.6 is used in the live app

When a poll creator uploads a voter eligibility file (CSV, Excel, or text) under **Settings → Validated Voters → Upload File**, the app doesn't require the file to match an exact column layout. Real-world voter lists are rarely consistent — one organizer might label a column `"Voter"`, another `"Full Name"`, another `"Sex"` instead of `"gender"` — and forcing a rigid template onto every creator would make the feature painful to use.

Instead of rejecting a file the moment its headers don't match the expected schema, the app calls **GPT-5.6 (Luna tier)** to automatically repair and realign a distorted or inconsistent header row before parsing continues — regardless of misspellings, reordering, abbreviations, or differently phrased column names.

---

## 📱 Screenshots

|                                                                                                                                                                                                                                                        |                                                                                                                                                                                                                                                |                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ![Google Sign-In](https://firebasestorage.googleapis.com/v0/b/evotingsystempro-788f7.firebasestorage.app/o/eVoting_System_Pro%2FeVotingScreenShotsv1%2FScreenshot_20260721-150026.jpg?alt=media&token=1bee9669-57d6-45fa-a575-d57c9fa70569)            | ![Platform Features](https://firebasestorage.googleapis.com/v0/b/evotingsystempro-788f7.firebasestorage.app/o/eVoting_System_Pro%2FeVotingScreenShotsv1%2FScreenshot_20260721-151044.jpg?alt=media&token=c3edb20e-43e3-478d-9d70-a3110b60f198) | ![All Polls](https://firebasestorage.googleapis.com/v0/b/evotingsystempro-788f7.firebasestorage.app/o/eVoting_System_Pro%2FeVotingScreenShotsv1%2FScreenshot_20260721-145436.jpg?alt=media&token=fa8a679e-bf96-4cea-b26a-491998b2812b)     |
| **Google Sign-In** — Secure onboarding                                                                                                                                                                                                                 | **Platform Features** — Feature walkthrough on first launch                                                                                                                                                                                    | **All Polls** — Browse live, active, and closed polls                                                                                                                                                                                      |
| ![Poll Results](https://firebasestorage.googleapis.com/v0/b/evotingsystempro-788f7.firebasestorage.app/o/eVoting_System_Pro%2FeVotingScreenShotsv1%2FScreenshot%202026-07-21%20at%2015.23.13.png?alt=media&token=74816698-96d8-4747-8285-e5a3e39419a2) | ![Wallet](https://firebasestorage.googleapis.com/v0/b/evotingsystempro-788f7.firebasestorage.app/o/eVoting_System_Pro%2FeVotingScreenShotsv1%2FScreenshot_20260721-145445.jpg?alt=media&token=1d20959d-59be-40f9-a0da-aa257d27c4cb)            | ![Create a Poll](https://firebasestorage.googleapis.com/v0/b/evotingsystempro-788f7.firebasestorage.app/o/eVoting_System_Pro%2FeVotingScreenShotsv1%2FScreenshot_20260721-145505.jpg?alt=media&token=4421b83c-39d6-42d8-9d59-88691aa5c084) |
| **Live Poll Results** — Real-time vote counts and rankings                                                                                                                                                                                             | **Wallet** — Crypto wallet, deposits, withdrawals & P2P transfers                                                                                                                                                                              | **Create a Poll** — Configure poll type, aspirants & details                                                                                                                                                                               |

### More Screenshots

|                                                                                                                                                                                                                                         |                                                                                                                                                                                                                                         |                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ![Screenshot](https://firebasestorage.googleapis.com/v0/b/evotingsystempro-788f7.firebasestorage.app/o/eVoting_System_Pro%2FeVotingScreenShotsv1%2FScreenshot_20260721-145609.jpg?alt=media&token=84c0ff54-b871-4421-ba90-50d7135b02ea) | ![Screenshot](https://firebasestorage.googleapis.com/v0/b/evotingsystempro-788f7.firebasestorage.app/o/eVoting_System_Pro%2FeVotingScreenShotsv1%2FScreenshot_20260721-145625.jpg?alt=media&token=cd4529b1-7d80-4112-aaa1-f2d479403382) | ![Screenshot](https://firebasestorage.googleapis.com/v0/b/evotingsystempro-788f7.firebasestorage.app/o/eVoting_System_Pro%2FeVotingScreenShotsv1%2FScreenshot_20260721-145639.jpg?alt=media&token=e3880821-797c-415c-9501-3eb5cd6238db) |
| Additional platform view                                                                                                                                                                                                                | Additional platform view                                                                                                                                                                                                                | Additional platform view                                                                                                                                                                                                                |
| ![Screenshot](https://firebasestorage.googleapis.com/v0/b/evotingsystempro-788f7.firebasestorage.app/o/eVoting_System_Pro%2FeVotingScreenShotsv1%2FScreenshot_20260721-145737.jpg?alt=media&token=1896bded-76e9-49e1-8519-aee31dd872d9) |                                                                                                                                                                                                                                         |                                                                                                                                                                                                                                         |
| Additional platform view                                                                                                                                                                                                                |                                                                                                                                                                                                                                         |                                                                                                                                                                                                                                         |

> 🎥 Prefer a walkthrough? Check out the **[tutorial video](https://firebasestorage.googleapis.com/v0/b/evotingsystempro-788f7.firebasestorage.app/o/eVoting_System_Pro%2FeVotingSystemPro-Screen-Videos%2FOPENAIBUILDWEEK.mp4?alt=media&token=c3431ee6-b1de-4b50-8486-1580bf72ff95)** above.

> ✏️ _Note: the captions in the "More Screenshots" section are generic placeholders — swap in the actual screen names (e.g. "Voter Management Dashboard", "Export Results", "Push Notification Alert") once you confirm which screen each image shows._

---

## 🎯 Core Features

| Feature                            | Description                                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔘 **Single-Choice Polls**         | Voters select exactly one candidate — ideal for elections, leadership votes, and referendums.                                                         |
| ☑️ **Multiple-Choice Polls**       | Voters select multiple candidates in one poll — ideal for committee elections and ranked preference voting.                                           |
| 💳 **Pay-Per-Vote**                | Charge a fee per vote, collected via Mobile Money, Card, or Crypto before a vote is cast.                                                             |
| 📄 **Import Eligible Voters**      | Upload a CSV, Excel, or text file of eligible voters — GPT-5.6 auto-corrects inconsistent or distorted column headers to match the platform's schema. |
| ⏰ **Scheduled Voting Windows**    | Set a precise start and end time; voting opens and closes automatically.                                                                              |
| 📊 **Real-Time Results**           | Live charts and counters update instantly as votes are cast and verified.                                                                             |
| 🛡️ **Fraud Prevention & Security** | Device fingerprinting and server-side verification block duplicate votes, bots, and manipulation attempts.                                            |
| 👥 **Voter Management Dashboard**  | Admins can view registered voters, track who has voted, and manage eligibility in real time.                                                          |
| 🔔 **Push Notification Alerts**    | Voters are notified when a poll opens, closes, or results are published.                                                                              |
| 📥 **Export Results**              | Download final results as a PDF or Excel report for record-keeping, auditing, or public announcement.                                                 |

---

## 🔧 Key Technical Capabilities

- ✅ Google Authentication (Sign-Up & Login)
- ✅ Firebase Authentication
- ✅ JWT-based token management (for native apps)
- ✅ Firebase Realtime Database for live presence & status tracking
- ✅ AI-powered customer support system
- ✅ AI-powered voter file header correction — Node.js backend + GPT-5.6 (Luna tier)
- ✅ Real-time chat system
- ✅ Real-time online/offline presence detection (`onDisconnect` / `onValue`)
- ✅ Push notifications via Expo Notifications
- ✅ Persistent local session caching with `AsyncStorage`
- ✅ Network status detection (online/offline handling)
- ✅ Cross-platform support (iOS, Android, Web) via Expo Router
- ✅ Session reset / clean logout flow with full storage cleanup
- ✅ OTA app updates via `expo-updates`

---

## Current Data Architecture

```
 CREATOR_DB ──── {creatorEmail} ────┬── creatorName: string
                                    ├── creatorEmail: string
                                    ├── status: "active" | "inactive"
                                    ├── dateCreated: string
                                    └── timeCreated: string

  POLL_TITLE_DB ── {pollId} ──┬── pollId: string
                              ├── title: string
                              ├── pollType: "single" | "multiple"
                              ├── face_verification: "true" | "false"
                              ├── requires_voters_validation: "true" | "false"
                              ├── poll_verification_status: "verified" | "not_verified"
                              ├── isAnonymous: boolean
                              ├── logoUrl: string
                              ├── showResults: boolean
                              ├── deadline: string | null      // ISO 8601
                              ├── status: "active" | "closed"
                              ├── aspirantCount: number
                              ├── creatorEmail: string
                              ├── creatorName: string
                              ├── createdAt: timestamp
                              ├── dateCreated: string
                              └── timeCreated: string

ASPIRANTS_DETAILS_DB ── {pollId}_{aspirantEmail} ──┬── pollId: string
                                                   ├── aspirantEmail: string
                                                   ├── name: string
                                                   ├── comment: string
                                                   ├── photo: string | ""
                                                   ├── votes: number
                                                   ├── lastVotedAt: timestamp | null
                                                   ├── creatorEmail: string
                                                   └── addedAt: timestamp

VALIDATED_VOTERS_DB ── {pollId} ── validatedVoterInfo ── {code} ──┬── validatedVoterCode: string (manual entry)
                                                                  └── <creator's own column names>: string (file upload)

  VOTERS_DB ── {pollId}_{voterEmail} ──┬── pollId: string
                                       ├── voterEmail: string
                                       ├── votersName: string
                                       ├── pollTitle: string
                                       ├── creatorEmail: string
                                       ├── aspirantVoted: string | string[] | null
                                       │     // single-vote: one aspirantEmail or null
                                       │     // multiple-vote: one entry per vote cast (duplicates intentional)
                                       └── votedAt: timestamp

WALLET_DB ── {userId} ──┬── email: string
                        ├── current_balance: number
                        ├── previous_balance: number
                        ├── transaction_amount: number
                        ├── transaction_type: string
                        ├── currency: string
                        ├── payment_method: string
                        ├── plan_id: string
                        ├── free_reset_credit: number
                        ├── monthly_subscription_plan: {
                        │      expires_at: number | null,
                        │      is_active: boolean,
                        │      is_suspended: boolean,
                        │      last_purchased_at: number | null,
                        │      started_at: number | null,
                        │      suspension_started_at: number | null,
                        │      total_purchases: number
                        │    }
                        ├── pay_as_you_go: { date_subscribed: number | null }
                        └── createdAt / updatedAt: timestamp

TRANSACTION_WALLET_DB ── {autoId} ──┬── email: string
                                    ├── transaction_id: string
                                    ├── external_transaction_id: string
                                    ├── transaction_type: "deposit" | "withdrawal" | "P2P_money_transfer" | "credit_purchase" | "subscription_purchase"
                                    ├── previous_balance: number | null
                                    ├── current_balance: number | null
                                    ├── transaction_amount: number | null
                                    ├── transaction_status: "pending approval" | "completed" | "failed" | "cancelled"
                                    ├── currency: string
                                    ├── payment_method: string
                                    ├── note: string
                                    ├── createdAt: timestamp
                                    ├── counterpartyEmail?: string // P2P only
                                    ├── counterpartyName?: string // P2P only
                                    ├── fee_amount?: number // withdrawal only
                                    ├── net_amount?: number // withdrawal only
                                    ├── withdrawal_destination?: string // withdrawal only
                                    ├── withdrawal_operator?: string | null // withdrawal only
                                    ├── withdrawal_country?: string // withdrawal only
                                    ├── withdrawal_country_name?: string // withdrawal only
                                    ├── withdrawal_currency?: string // withdrawal only
                                    ├── subscription_snapshot?: {
                                    │ plan: "monthly", expires_at: number,
                                    │ stacked: boolean, total_purchases: number
                                    │ }
                                    └── credit_snapshot?: {
                                                            plan: "payg", credits_purchased: number,
                                                            credits_total_after: number, price_per_credit: number
                                                           }

members_list_db ── {userId} ──┬── actualFullname: string
                              ├── actualDayOfBirth: string
                              ├── actualMonthOfBirth: string
                              ├── actualYearOfBirth: string
                              ├── actualGender: "male" | "female" | "other" | "prefer_not_to_say"
                              ├── phone: string
                              ├── createdAt: string | timestamp
                              ├── badges: number
                              ├── clientName: string
                              └── iconUrl: { color: string }
```

---

## ⚙️ Prerequisites

- A [Firebase](https://firebase.google.com/) project with **Authentication** and **Realtime Database** enabled
- [Expo CLI](https://docs.expo.dev/get-started/installation/) installed globally
- [Node.js](https://nodejs.org/) for running the backend email/notification/AI-mapping service
- An [OpenAI API key](https://platform.openai.com/api-keys) with billing enabled, for the GPT-5.6 voter-header-correction feature

---

## 🌍 Environment Setup

Create a `.env` file in the app's root directory with your Firebase project credentials:

```bash
FIREBASE_API_KEY=your_firebase_api_key
FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_STORAGE_BUCKET=your_project.appspot.com
FIREBASE_MESSAGING_SENDER_ID=your_sender_id
FIREBASE_APP_ID=your_app_id
FIREBASE_DATABASE_URL=https://your_project.firebaseio.com
```

The **Node.js backend service** (`/email-service`) requires its own `.env` file:

```bash
OPENAI_API_KEY=your_openai_api_key       # required for GPT-5.6 header correction
FIREBASE_SERVICE_ACCOUNT_KEY=your_service_account_json   # for admin-level Firestore/RTDB writes
EMAIL_SERVICE_USER=your_smtp_or_provider_username
EMAIL_SERVICE_PASSWORD=your_smtp_or_provider_password
PORT=3000
```

> Never commit either `.env` file. Both are already covered by `.gitignore`.

---

## ▶️ Getting Started

1. **Clone the repository**

   ```bash
   git clone https://github.com/evotingsystempro
   cd evotingsystempro
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Run the app**

   ```bash
   npx expo start          # Start Expo dev server
   npx expo run:ios        # iOS Simulator
   npx expo run:android    # Android Emulator
   npx expo start --web    # Web browser
   ```

4. **Run the backend service** (email verification, push notifications, GPT-5.6 header correction)

   ```bash
   cd email-service
   npm install
   npm start
   ```

5. **Build for production**

   ```bash
   eas build --platform ios --profile production
   eas build --platform android
   npx expo export --platform web -c   # Web export
   ```

---

## 🔗 Tech Stack

| Layer         | Technology                 |
| ------------- | -------------------------- |
| Framework     | Expo (React Native)        |
| Navigation    | Expo Router                |
| Backend       | Node.js + Express          |
| Database      | Firebase Realtime Database |
| Auth          | Firebase Authentication    |
| AI            | OpenAI GPT-5.6 (Luna tier) |
| Dev Tooling   | OpenAI Codex CLI           |
| Notifications | Expo Push Notifications    |
| Local Storage | AsyncStorage               |

---

## 📺 Demo & Resources

- 🎥 **[Tutorial Video](https://firebasestorage.googleapis.com/v0/b/evotingsystempro-788f7.firebasestorage.app/o/eVoting_System_Pro%2FeVotingSystemPro-Screen-Videos%2FOPENAIBUILDWEEK.mp4?alt=media&token=c3431ee6-b1de-4b50-8486-1580bf72ff95)** — See the platform in action.
- 💻 **[GitHub Organization](https://github.com/evotingsystempro)** — Source code and repositories.
- 🌐 **[Live Application](https://evotingsystempro.expo.app)** — Try eVoting System Pro in your browser.

---

## 📚 Learn More

- [Expo Documentation](https://docs.expo.dev/)
- [Firebase Documentation](https://firebase.google.com/docs)
- [OpenAI Codex Documentation](https://developers.openai.com/codex)

---

## 📄 License

Private & Proprietary — All rights reserved © eVoting System Pro
