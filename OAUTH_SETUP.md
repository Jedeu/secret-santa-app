# Google OAuth Setup Instructions

Follow these steps to configure Google OAuth for the Secret Santa app:

## 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" at the top, then "New Project"
3. Name your project (e.g., "Secret Santa App")
4. Click "Create"

## 2. Enable Google+ API

1. In your project, go to "APIs & Services" > "Library"
2. Search for "Google+ API"
3. Click on it and press "Enable"

## 3. Create OAuth Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "+ CREATE CREDENTIALS" > "OAuth client ID"
3. If prompted, configure the OAuth consent screen:
   - User Type: External (or Internal if you have a Google Workspace)
   - App name: "Secret Santa"
   - User support email: Your email
   - Developer contact: Your email
   - Click "Save and Continue" through the rest
4. Back at "Create OAuth client ID":
   - Application type: "Web application"
   - Name: "Secret Santa Web Client"
   - Authorized redirect URIs: Add `http://localhost:3000/api/auth/callback/google`
   - Click "Create"
5. Copy your Client ID and Client Secret

## 4. Update .env.local

1. Open `.env.local` in your project
2. Replace `your_google_client_id_here` with your Client ID
3. Replace `your_google_client_secret_here` with your Client Secret

## 5. Restart the Development Server

```bash
# Stop the current dev server (Ctrl+C)
# Start it again
npm run dev
```

## 6. Test Authentication

1. Open http://localhost:3000
2. Click "Sign in with Google"
3. Select your Google account
4. Grant permissions
5. You should be redirected back to the app and prompted to enter your recipient

---

**Note:** The NextAuth secret has already been generated for you in `.env.local`. For production deployment, you'll need to:
- Add your production URL to Google OAuth authorized redirect URIs
- Update `NEXTAUTH_URL` in your production environment variables
