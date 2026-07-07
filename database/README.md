# Monochrome PocketBase Database & Auth Setup Guide

This directory contains the database schema and setup instructions for running Monochrome with your own self-hosted **PocketBase** instance.

PocketBase acts as the unified cloud backend for Monochrome, handling both user authentication (Email/Password & Social OAuth2) and real-time relational library synchronization (`profiles`, `library_items`, `history_items`, `playlists`, `folders`).

---

## 1. Importing the Schema

1. Download and install [PocketBase](https://pocketbase.io/docs/).
2. Start your PocketBase server and open the Admin Console (e.g., `http://localhost:8090/_/` or `https://pb.bitperfect.remotewire.net/_/`).
3. Navigate to **Settings > Import collections**.
4. Click **Load from JSON file** and select `pb_schema.json` located in this directory.
5. Click **Import**. This will automatically create all necessary relational collections: `profiles`, `library_items`, `history_items`, `playlists`, `playlist_tracks`, `folders`, and `folder_playlists`.

> [!NOTE]
> All relational collections in `pb_schema.json` are linked directly to PocketBase's official built-in **`users`** auth collection (`_pb_users_auth_`). If you previously imported an older schema that created an `app_users` Base table, you can safely delete the `app_users` collection in your admin console.

---

## 2. Configuring Authentication Providers

In PocketBase (v0.23 and newer), authentication methods and OAuth2 providers are configured **per auth collection** rather than in global settings.

### How to Access Auth Configuration:
1. In your PocketBase Admin Console, click on **Collections** in the left sidebar.
2. Select the **`users`** collection.
3. Click the **Edit collection** button (the gear/cogwheel icon next to `users` at the top of the page).
4. Switch to the **Options** tab in the edit panel.

---

### Email / Password Authentication
- In the **Options** tab of the `users` collection, ensure **Identity / Password** is enabled.
- *(Optional)* Configure your SMTP server under **Settings > Mail settings** if you want to support email verification and password reset emails.

---

### OAuth2 Social Logins (Google, GitHub, Discord)

> [!IMPORTANT]
> When connecting social accounts, PocketBase acts as the OAuth2 client. You must register an OAuth application with each provider and copy the generated **Client ID** and **Client Secret** into PocketBase under **Collections > users > Edit collection > Options > OAuth2**.
> 
> **Your PocketBase OAuth2 Redirect URL:**
> ```
> https://your-pocketbase-domain.com/api/oauth2-redirect
> ```
> *(Example: `https://pb.bitperfect.remotewire.net/api/oauth2-redirect`)*

#### A. Google OAuth2 Setup
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or select an existing one) and navigate to **APIs & Services > Credentials**.
3. Click **Create Credentials > OAuth client ID**.
4. Select **Web application** as the application type.
5. Under **Authorized redirect URIs**, add your PocketBase OAuth2 redirect URL:
   `https://pb.bitperfect.remotewire.net/api/oauth2-redirect`
6. Click **Create**. Copy the **Client ID** and **Client Secret**.
7. In your PocketBase Admin Console, go to **Collections > users > Edit collection (gear icon) > Options > OAuth2**, enable **Google**, paste the Client ID and Secret, and click **Save**.

#### B. GitHub OAuth2 Setup
1. Go to your GitHub account **Settings > Developer settings > OAuth Apps > New OAuth App**.
2. Fill in the application name and homepage URL (your Monochrome app domain).
3. In the **Authorization callback URL** field, enter your PocketBase OAuth2 redirect URL:
   `https://pb.bitperfect.remotewire.net/api/oauth2-redirect`
4. Click **Register application**.
5. Click **Generate a new client secret**. Copy the **Client ID** and **Client Secret**.
6. In your PocketBase Admin Console, go to **Collections > users > Edit collection (gear icon) > Options > OAuth2**, enable **GitHub**, paste the Client ID and Secret, and click **Save**.

#### C. Discord OAuth2 Setup
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. Give your application a name and navigate to the **OAuth2** tab in the left sidebar.
3. Under **Redirects**, add your PocketBase OAuth2 redirect URL:
   `https://pb.bitperfect.remotewire.net/api/oauth2-redirect`
4. Copy the **Client ID** and **Client Secret** (click **Reset Secret** if needed).
5. In your PocketBase Admin Console, go to **Collections > users > Edit collection (gear icon) > Options > OAuth2**, enable **Discord**, paste the Client ID and Secret, and click **Save**.

---

## 3. Connecting Monochrome to Your PocketBase Server

Once your server is configured:
1. Open Monochrome and go to **Settings > Account**.
2. Under **Custom Database/Auth**, enter your PocketBase URL (e.g., `https://pb.bitperfect.remotewire.net`).
3. Click **Save & Reload**. Monochrome will now authenticate users and sync library data directly with your relational PocketBase tables!
