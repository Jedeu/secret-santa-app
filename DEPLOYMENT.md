# Secret Santa Deployment Guide

This guide will help you deploy your Secret Santa application to Vercel with a Firebase backend and Google OAuth.

## Prerequisites

- A Google Cloud Account
- A Firebase Account
- A Vercel Account
- A GitHub Account

## 1. Firebase Setup (Database)

1. Go to [Firebase Console](https://console.firebase.google.com/) and create a new project.
2. Navigate to **Build > Firestore Database**.
3. Click **Create Database**.
    - Start in **Production mode**.
    - Choose a location close to you.
4. Go to **Project Settings** (gear icon) > **Service accounts**.
5. Click **Generate new private key**. This will download a JSON file. **Keep this safe!** You will need the contents of this file for Vercel environment variables.

## 2. Google OAuth Setup (Authentication)

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Select your Firebase project (it should be listed).
3. Go to **APIs & Services > Credentials**.
4. Click **Create Credentials > OAuth client ID**.
    - Application type: **Web application**.
    - Name: `Secret Santa App`.
    - **Authorized JavaScript origins**:
        - `http://localhost:3000` (for local testing)
        - `https://your-vercel-app-name.vercel.app` (you will add this later after deploying).
    - **Authorized redirect URIs**:
        - `http://localhost:3000/api/auth/callback/google`
        - `https://your-vercel-app-name.vercel.app/api/auth/callback/google`
5. Click **Create**. Copy the **Client ID** and **Client Secret**.

## 3. Vercel Deployment

1. Push your code to a GitHub repository.
2. Go to [Vercel Dashboard](https://vercel.com/dashboard) and click **Add New > Project**.
3. Import your GitHub repository.
4. In the **Configure Project** screen, expand **Environment Variables**.
5. Add the following variables:

| Variable Name | Value | Description |
| :--- | :--- | :--- |
| `GOOGLE_CLIENT_ID` | `YOUR_CLIENT_ID` | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | `YOUR_CLIENT_SECRET` | From Google Cloud Console |
| `NEXTAUTH_URL` | `https://your-app-name.vercel.app` | Your Vercel URL (or http://localhost:3000 for local) |
| `NEXTAUTH_SECRET` | `Generate a random string` | Use `openssl rand -base64 32` to generate |
| `FIREBASE_PROJECT_ID` | `your-project-id` | From Firebase Project Settings |
| `FIREBASE_CLIENT_EMAIL` | `your-service-account-email` | From the downloaded JSON file (`client_email`) |
| `FIREBASE_PRIVATE_KEY` | `-----BEGIN PRIVATE KEY-----...` | From the downloaded JSON file (`private_key`). **Copy the entire string including newlines.** |

6. Click **Deploy**.

## 4. Post-Deployment Steps

1. Once deployed, copy your Vercel URL (e.g., `https://secret-santa-app.vercel.app`).
2. Go back to **Google Cloud Console > Credentials** and update the **Authorized JavaScript origins** and **Authorized redirect URIs** with your actual Vercel URL.
3. **Blind Pairing**:
    - To assign Secret Santas, you need to trigger the assignment logic.
    - You can do this by making a POST request to your API (e.g., using Postman or curl), OR I can add a hidden button for you if you prefer.
    - **Endpoint**: `POST https://your-app.vercel.app/api/auth`
    - **Body**: `{"action": "assign"}`
    - **Note**: This will re-shuffle everyone. Ensure all users have signed in at least once before running this!

## 5. Verification

1. Visit your deployed app.
2. Sign in with Google.
3. Verify you can see the dashboard.
