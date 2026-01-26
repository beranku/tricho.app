# TrichoApp User Guide

Welcome to TrichoApp! This guide will help you get started with your secure, encrypted customer management system.

## Table of Contents

1. [Getting Started](#getting-started)
2. [First-Time Setup](#first-time-setup)
3. [Daily Use](#daily-use)
4. [Managing Customers](#managing-customers)
5. [Taking Photos](#taking-photos)
6. [Syncing Across Devices](#syncing-across-devices)
7. [Account Recovery](#account-recovery)
8. [Settings](#settings)
9. [Troubleshooting](#troubleshooting)
10. [FAQ](#faq)

---

## Getting Started

### What is TrichoApp?

TrichoApp is a secure CRM (Customer Relationship Management) app designed specifically for hairdressers. It helps you:

- **Manage customer information** - Names, contact details, notes
- **Track visits** - Services performed, products used, observations
- **Store photos** - Before/after photos, scalp conditions
- **Work offline** - No internet? No problem!
- **Sync across devices** - Your phone, tablet, and computer stay in sync

### Why is Security Important?

Your customers trust you with their personal information. TrichoApp uses **end-to-end encryption** which means:

- Only YOU can read your data
- The cloud server only sees encrypted gibberish
- Even if someone hacks the server, they can't read anything
- Your customers' privacy is protected

---

## First-Time Setup

### Step 1: Open the App

Open TrichoApp in your browser or install it as a PWA (Progressive Web App):
- **iOS Safari**: Tap Share → "Add to Home Screen"
- **Android Chrome**: Tap menu (⋮) → "Add to Home Screen"
- **Desktop**: Look for the install icon in the address bar

### Step 2: Create Your Account

1. Tap **"Create Account"**
2. Enter your email address
3. Follow the prompts to register your passkey

### Step 3: Register Your Passkey

A **passkey** is your secure login method using Face ID, fingerprint, or device PIN:

1. When prompted, allow biometric authentication
2. Verify with your Face ID, fingerprint, or PIN
3. Your passkey is now registered!

**Benefits of passkeys:**
- No passwords to remember
- Cannot be phished or stolen
- Unique to your device
- Works even offline

### Step 4: Save Your Recovery QR Code

**⚠️ THIS IS CRITICAL - DO NOT SKIP!**

After setup, you'll see a **Recovery QR Code**. This is your backup key to access your data if:
- You lose your device
- Your device is reset
- You need to set up a new device

**How to save it:**

1. **Take a screenshot** and store it in a secure location
2. **Print it out** and keep it in a safe place
3. **Write down the backup code** if you prefer text

**Important:**
- Store it somewhere secure (safe, locked drawer)
- Do NOT store it on the same device
- Anyone with this code can access your account
- You can view it again later in Settings

---

## Daily Use

### Unlocking the App

1. Open TrichoApp
2. Verify with Face ID/fingerprint/PIN
3. You're in!

**Tip:** The app automatically locks when you close it to protect your data.

### The Main Screen

After unlocking, you'll see:

```
┌────────────────────────────────────┐
│  TrichoApp                    [⚙]  │  ← Settings
├────────────────────────────────────┤
│  🔍 Search customers...            │  ← Search bar
├────────────────────────────────────┤
│  ┌──────────────────────────────┐  │
│  │ 👤 Marie Novákova            │  │
│  │    Last visit: Jan 15        │  │
│  ├──────────────────────────────┤  │
│  │ 👤 Jana Svobodová            │  │
│  │    Last visit: Jan 10        │  │
│  ├──────────────────────────────┤  │
│  │ 👤 Petra Králová             │  │
│  │    Last visit: Jan 5         │  │
│  └──────────────────────────────┘  │
│                                    │
│        [+ Add Customer]            │  ← Add new customer
├────────────────────────────────────┤
│  ● Online   Synced ✓              │  ← Sync status
└────────────────────────────────────┘
```

---

## Managing Customers

### Adding a New Customer

1. Tap **"+ Add Customer"**
2. Fill in the details:
   - **Name** (required)
   - **Phone number**
   - **Email**
   - **Notes** (e.g., hair type, preferences)
   - **Allergies** (important!)
   - **Preferred products**
3. Tap **"Save"**

### Viewing Customer Details

1. Tap on a customer's name in the list
2. You'll see their profile with:
   - Contact information
   - Visit history
   - Photos
   - Notes

### Editing Customer Information

1. Open the customer's profile
2. Tap **"Edit"**
3. Make your changes
4. Tap **"Save"**

### Recording a Visit

1. Open the customer's profile
2. Tap **"+ Add Visit"**
3. Record:
   - **Date** (defaults to today)
   - **Services** performed
   - **Products** used
   - **Price**
   - **Notes/observations**
4. Tap **"Save"**

### Deleting a Customer

1. Open the customer's profile
2. Tap **"Delete"**
3. Confirm deletion

**Note:** Deleted data cannot be recovered.

---

## Taking Photos

### Capturing a Photo

1. Open a customer's profile
2. Tap **"Add Photo"** or the camera icon
3. Allow camera access if prompted
4. Take the photo
5. Add optional details:
   - Caption
   - Body region (scalp top, sides, etc.)
   - Notes
6. Tap **"Save"**

### Importing Existing Photos

1. Tap **"Add Photo"**
2. Choose **"Import from Gallery"**
3. Select the photo
4. Add details and save

### Viewing Photos

1. Open a customer's profile
2. Scroll to the **Photos** section
3. Tap any photo to view full size

### Photo Privacy

All photos are:
- **Encrypted** before leaving your device
- **Stored encrypted** in the cloud
- **Only viewable** by you with your passkey

---

## Syncing Across Devices

### How Sync Works

1. Changes made on any device are **encrypted locally**
2. Encrypted data is **sent to the cloud** when online
3. Other devices **download and decrypt** the changes
4. Everything stays in sync!

### Sync Status Indicators

| Indicator | Meaning |
|-----------|---------|
| ● Online | Connected to internet |
| ○ Offline | No internet connection |
| ↻ Syncing | Data is being synced |
| ✓ Synced | All data is up to date |
| ⚠ Pending | Changes waiting to sync |

### Manual Sync

1. Go to **Settings** (⚙)
2. Tap **"Sync Now"**

**Tip for iOS users:** The app syncs automatically when you open it. There's no background sync on iOS.

### Setting Up Additional Devices

1. On your new device, open TrichoApp
2. Tap **"I have an account"**
3. Tap **"Scan Recovery QR"**
4. Scan your Recovery QR code
5. Register a new passkey for this device
6. Your data will sync automatically

---

## Account Recovery

### If You Lose Your Device

1. Get a new device
2. Open TrichoApp
3. Tap **"Recover Account"**
4. Scan your Recovery QR code
5. Register a new passkey
6. All your data syncs from the cloud

### If Your Passkey Doesn't Work

This can happen if:
- You reset your device
- Biometrics were updated
- The passkey was deleted

**Solution:**
1. Tap **"Use Recovery Code"**
2. Scan your Recovery QR code
3. Register a new passkey

### Lost Recovery QR Code?

If you still have access to the app:
1. Go to **Settings** → **Security**
2. Tap **"Show Recovery Code"**
3. Verify with your passkey
4. Save the QR code securely

**If you've lost both your device AND recovery code:**
Unfortunately, your data cannot be recovered. This is the tradeoff for end-to-end encryption - only YOU can access your data.

---

## Settings

### Access Settings

Tap the **gear icon (⚙)** in the top-right corner.

### Available Settings

| Setting | Description |
|---------|-------------|
| **Account** | Email, passkey management |
| **Security** | View/export recovery code |
| **Sync** | Sync status, manual sync button |
| **Photos** | Image quality, storage usage |
| **About** | App version, support info |

### Photo Quality Settings

- **High Quality** - Best detail, larger files, slower sync
- **Medium** (recommended) - Good balance
- **Low** - Smaller files, faster sync

### Storage Usage

View how much space TrichoApp is using:
- Local database size
- Photo storage
- Clear cache option

---

## Troubleshooting

### App Won't Open

1. Close and reopen the app
2. Clear browser cache if using web version
3. Reinstall the app

### Can't Login with Passkey

1. Make sure biometrics (Face ID/fingerprint) are working
2. Try using your device PIN
3. Use the Recovery QR code if passkey is broken

### Sync Not Working

1. Check your internet connection
2. Try **Settings → Sync Now**
3. Wait a few minutes and try again
4. Check if the server is online

### Photos Not Uploading

1. Check your internet connection
2. Photos upload in the background when online
3. Look for the ⚠ indicator showing pending uploads
4. Try manually syncing

### "Offline" Shown but You Have Internet

1. Refresh the page/app
2. Check if other apps can connect
3. The sync server might be temporarily down

---

## FAQ

### Is my data really encrypted?

Yes! Your data is encrypted on your device using AES-256-GCM encryption before being sent anywhere. The server only ever sees encrypted data that it cannot read.

### Can TrichoApp see my customer data?

No. End-to-end encryption means only you can decrypt and read your data. Even if our servers were hacked, attackers would only get encrypted gibberish.

### What if I forget my passkey?

Use your Recovery QR code to set up a new passkey. The recovery code is the only way to regain access if your passkey is lost.

### Can I use TrichoApp on multiple devices?

Yes! Set up each device using your Recovery QR code. All devices stay in sync automatically.

### Does TrichoApp work offline?

Yes! You can view and edit all your data offline. Changes sync automatically when you're back online.

### How do I export my data?

Currently, data export is handled through the recovery code. Full export functionality is planned for a future update.

### Is there a limit on customers/photos?

There's no hard limit, but very large amounts of data may affect performance. The recommended limit is:
- ~1000 customers
- ~10 photos per customer

### How do I delete my account?

Go to **Settings → Account → Delete Account**. This permanently deletes all your data from the server. You'll need your Recovery QR to confirm.

---

## Getting Help

If you have questions or run into problems:

1. Check this guide and FAQ
2. Contact support: support@tricho.app
3. Visit: https://tricho.app/help

---

**Remember:** Your Recovery QR code is the key to your data. Keep it safe!
