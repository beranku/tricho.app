# TrichoApp User Guide

Welcome to TrichoApp! This guide will help you get started with your secure, encrypted customer management system designed specifically for hairdressers.

## Table of Contents

1. [Getting Started](#getting-started)
2. [First-Time Setup](#first-time-setup)
3. [Daily Use](#daily-use)
4. [Managing Customers](#managing-customers)
5. [Recording Visits](#recording-visits)
6. [Taking and Managing Photos](#taking-and-managing-photos)
7. [Syncing Across Devices](#syncing-across-devices)
8. [Account Recovery](#account-recovery)
9. [Settings](#settings)
10. [Troubleshooting](#troubleshooting)
11. [FAQ](#faq)
12. [Privacy & Security](#privacy--security)

---

## Getting Started

### What is TrichoApp?

TrichoApp is a secure CRM (Customer Relationship Management) app designed specifically for hairdressers and salon professionals. It helps you:

- **Manage customer information** - Names, contact details, preferences, notes
- **Track visits** - Services performed, products used, observations, pricing
- **Store photos** - Before/after photos, scalp conditions, style inspirations
- **Work offline** - No internet? No problem! Everything works locally
- **Sync across devices** - Your phone, tablet, and computer stay in sync automatically
- **Protect privacy** - All data is encrypted end-to-end

### Why End-to-End Encryption?

Your customers trust you with their personal information and photos. TrichoApp uses **end-to-end encryption** (E2EE) which means:

| What happens | Traditional apps | TrichoApp (E2EE) |
|--------------|------------------|------------------|
| Where is data encrypted? | On the server | On YOUR device |
| Who can read your data? | The company, hackers | Only YOU |
| If server is hacked? | All data exposed | Only encrypted gibberish |
| Who holds the keys? | The company | Only YOU |

**Your data never leaves your device unencrypted.** Even we cannot read your customer information.

### System Requirements

| Device | Requirements |
|--------|--------------|
| **iPhone/iPad** | iOS 16+ with Safari |
| **Android** | Chrome 109+ |
| **Mac** | Safari 16+ or Chrome 109+ |
| **Windows** | Chrome 109+ or Edge 109+ |

**Note:** TrichoApp requires WebAuthn support for passkey authentication.

---

## First-Time Setup

### Step 1: Install TrichoApp

TrichoApp is a Progressive Web App (PWA). Install it for the best experience:

#### On iPhone/iPad (Safari):
1. Open Safari and navigate to the TrichoApp URL
2. Tap the **Share** button (square with arrow)
3. Scroll down and tap **"Add to Home Screen"**
4. Tap **"Add"** in the top right

#### On Android (Chrome):
1. Open Chrome and navigate to the TrichoApp URL
2. Tap the **three-dot menu** (⋮)
3. Tap **"Add to Home screen"** or **"Install app"**
4. Tap **"Add"**

#### On Desktop (Chrome/Edge):
1. Navigate to the TrichoApp URL
2. Look for the **install icon** in the address bar (⊕ or similar)
3. Click **"Install"**

### Step 2: Create Your Account

1. Open TrichoApp from your home screen
2. Tap **"Create Account"**
3. Enter your email address
4. Tap **"Continue"**

### Step 3: Register Your Passkey

A **passkey** replaces passwords. It uses your device's biometrics (Face ID, fingerprint) or PIN:

1. When prompted, tap **"Create Passkey"**
2. Verify using Face ID, fingerprint, or device PIN
3. Your passkey is now registered!

**Why passkeys are better than passwords:**
- ✅ No passwords to remember or forget
- ✅ Cannot be phished or stolen
- ✅ Unique to your device
- ✅ Works even offline
- ✅ Faster than typing passwords

### Step 4: Save Your Recovery QR Code

**⚠️ THIS IS THE MOST IMPORTANT STEP - DO NOT SKIP!**

After setup, you'll see a **Recovery QR Code**. This is your ONLY way to access your data if:
- You lose your device
- Your device is reset
- You need to set up a new device
- Your passkey stops working

#### How to Save It:

**Option 1: Take a Screenshot (Recommended)**
1. Take a screenshot of the QR code
2. Save it to a secure location:
   - Password-protected cloud storage (iCloud, Google Drive)
   - A secure notes app
   - Email it to yourself
   - Print it and store in a safe

**Option 2: Print It**
1. Tap **"Download QR"** or **"Print"**
2. Print the page
3. Store the printout in a secure location (safe, locked drawer)

**Option 3: Copy the Backup Code**
1. Tap **"Show text backup"**
2. Write down or copy the text code
3. Store securely

#### CRITICAL WARNINGS:

| ⚠️ Do NOT... | Why |
|-------------|-----|
| Store only on the same device | If device is lost, you lose access |
| Share with others | Anyone with this code can access your data |
| Save in unprotected locations | Keep it secure like a bank PIN |
| Skip this step | There is NO other way to recover your data |

### Step 5: Confirm Recovery Code Saved

1. Check the confirmation boxes:
   - ☑️ I have saved the recovery QR code
   - ☑️ I understand I cannot recover my data without it
2. Tap **"I've Saved My Recovery Code"**
3. You're ready to use TrichoApp!

---

## Daily Use

### Unlocking the App

Every time you open TrichoApp:

1. Open the app from your home screen
2. Verify with Face ID, fingerprint, or PIN
3. You're in!

**Tip:** The app automatically locks when you close it to protect your customer data.

### Understanding the Home Screen

```
┌────────────────────────────────────────────────────────────────────┐
│  TrichoApp                                              [⚙️ Settings]
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  🔍 Search customers...                                            │
│                                                                     │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Recent Customers                                                   │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  👤 Marie Novákova                                 Jan 15  │    │
│  │     Hair coloring, highlights                              │    │
│  ├────────────────────────────────────────────────────────────┤    │
│  │  👤 Jana Svobodová                                 Jan 10  │    │
│  │     Cut and blowdry                                        │    │
│  ├────────────────────────────────────────────────────────────┤    │
│  │  👤 Petra Králová                                  Jan 5   │    │
│  │     Scalp treatment                                        │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                     │
│                    [+ Add Customer]                                 │
│                                                                     │
├────────────────────────────────────────────────────────────────────┤
│  ● Online                            Last synced: 2 minutes ago    │
└────────────────────────────────────────────────────────────────────┘
```

### Status Indicators

| Icon | Status | Meaning |
|------|--------|---------|
| ● Online | Green | Connected to internet |
| ○ Offline | Gray | No internet connection |
| ↻ Syncing | Blue, animated | Data is being synced |
| ✓ Synced | Green checkmark | All data is up to date |
| ⚠ Pending | Yellow warning | Changes waiting to sync |
| ❌ Error | Red | Sync error, see details |

---

## Managing Customers

### Adding a New Customer

1. From the home screen, tap **"+ Add Customer"**
2. Fill in the customer details:

| Field | Required | Example |
|-------|----------|---------|
| **Name** | Yes | Marie Novákova |
| **Phone** | No | +420 123 456 789 |
| **Email** | No | marie@email.cz |
| **Notes** | No | Prefers natural products |
| **Allergies** | No | Allergic to ammonia |
| **Preferred products** | No | Olaplex, Kerastase |
| **Date of birth** | No | 1985-03-15 |

3. Tap **"Save"**

**Tip:** The more details you add, the better you can personalize their experience!

### Finding a Customer

#### Quick Search:
1. Tap the **search bar** at the top
2. Start typing the customer's name
3. Results appear as you type
4. Tap to open their profile

#### Browse All:
1. Scroll through the customer list
2. Use sort options: **Recent**, **Name A-Z**, **Name Z-A**

### Viewing Customer Details

Tap on any customer to see their full profile:

```
┌────────────────────────────────────────────────────────────────────┐
│  ← Back                                                    [Edit]  │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│         👤                                                          │
│      Marie Novákova                                                 │
│                                                                     │
│  📱 +420 123 456 789                                               │
│  ✉️  marie@email.cz                                                │
│                                                                     │
├────────────────────────────────────────────────────────────────────┤
│  📋 Notes                                                           │
│  ─────────────────────────────────────────────────────────────     │
│  Prefers natural products. Fine hair, sensitive scalp.             │
│  Likes longer layers around face.                                  │
│                                                                     │
│  ⚠️ Allergies: Ammonia                                             │
│                                                                     │
├────────────────────────────────────────────────────────────────────┤
│  📅 Visit History                              [+ Add Visit]        │
│  ─────────────────────────────────────────────────────────────     │
│  Jan 15, 2026 - Color touch-up, gloss treatment    €85             │
│  Dec 10, 2025 - Full highlights, cut, style        €145            │
│  Nov 5, 2025 - Cut and blowdry                     €45             │
│                                                                     │
├────────────────────────────────────────────────────────────────────┤
│  📷 Photos                                     [+ Add Photo]        │
│  ─────────────────────────────────────────────────────────────     │
│  [Photo 1]  [Photo 2]  [Photo 3]  [Photo 4]                        │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

### Editing Customer Information

1. Open the customer's profile
2. Tap **"Edit"** in the top right
3. Make your changes
4. Tap **"Save"**

### Deleting a Customer

1. Open the customer's profile
2. Scroll down and tap **"Delete Customer"**
3. Read the warning - deletion is permanent
4. Type the customer's name to confirm
5. Tap **"Delete Permanently"**

**Warning:** Deleting a customer removes ALL their data including visits and photos. This cannot be undone.

---

## Recording Visits

### Adding a Visit

1. Open the customer's profile
2. Tap **"+ Add Visit"** in the Visit History section
3. Fill in the visit details:

| Field | Description |
|-------|-------------|
| **Date** | When the visit occurred (defaults to today) |
| **Services** | What you did (cut, color, treatment, etc.) |
| **Products used** | Products applied during the visit |
| **Duration** | How long the appointment took |
| **Price** | Total cost |
| **Notes** | Observations, formula notes, next steps |

4. Tap **"Save Visit"**

### Common Workflow: Appointment Day

1. **Before the appointment:**
   - Open customer profile
   - Review previous visits and notes
   - Check for allergies

2. **During/After the appointment:**
   - Take photos if needed
   - Tap **"+ Add Visit"**
   - Record services and products
   - Note any observations
   - Save the visit

3. **Before they leave:**
   - Show them before/after photos
   - Discuss next appointment timing

### Editing a Visit

1. Open the customer's profile
2. Tap on the visit you want to edit
3. Make changes
4. Tap **"Save"**

---

## Taking and Managing Photos

### Why Photos Matter

Photos help you:
- Track hair color formulas and results
- Monitor scalp conditions over time
- Show clients their transformation
- Plan future services

**Privacy:** All photos are encrypted on your device before upload. No one else can see them.

### Capturing a New Photo

1. Open the customer's profile
2. Tap **"+ Add Photo"** or the **camera icon**
3. Allow camera access if prompted
4. Point at the subject and tap **capture**
5. Review the photo

### Photo Details

After capturing, add details:

| Field | Example |
|-------|---------|
| **Caption** | "Before color treatment" |
| **Body region** | Scalp top, sides, back, full head |
| **Notes** | "Using 6N with 20vol developer" |
| **Tags** | Color, before, roots |

### Importing from Gallery

1. Tap **"+ Add Photo"**
2. Choose **"Import from Gallery"**
3. Select the photo
4. Add details and save

### Viewing Photos

1. Open customer's profile
2. Scroll to the **Photos** section
3. Tap any thumbnail to view full size
4. Swipe left/right to browse

### Photo Tips

- **Good lighting** - Natural light is best
- **Consistent angles** - Use same angles for before/after
- **Label clearly** - Add captions so you remember context
- **Date organization** - Photos are sorted by date automatically

---

## Syncing Across Devices

### How Sync Works

1. You make changes on any device (create customer, add visit, take photo)
2. Changes are **encrypted locally** on your device
3. When online, **encrypted data** is sent to the cloud
4. Other devices **download and decrypt** automatically
5. Everything stays in sync!

```
Device 1 (Phone)                 Cloud                  Device 2 (Tablet)
      │                           │                           │
      │  Create customer          │                           │
      │  ─────────────────────►   │                           │
      │  (encrypted)              │                           │
      │                           │   ◄─────────────────────  │
      │                           │   (encrypted)             │
      │                           │                           │
      │                           │   "New customer"          │
      │                           │   ─────────────────────►  │
      │                           │                           │
      │                           │                    Decrypt│
      │                           │                    & show │
```

### Manual Sync

To force a sync immediately:

1. Pull down on the customer list (pull-to-refresh), or
2. Go to **Settings** → **Sync** → **"Sync Now"**

### iOS Users: Important Note

iOS does not support background sync for web apps. TrichoApp handles this by:
- Syncing when you **open the app**
- Syncing when you **return to the app** from another app
- Providing a **manual sync button**

**Tip:** If you've been offline, just open TrichoApp when back online and sync happens automatically.

### Setting Up a New Device

#### If you still have your old device:

1. On new device, open TrichoApp
2. Tap **"I have an account"**
3. Tap **"Scan Recovery QR"**
4. Scan your recovery QR code
5. Register a new passkey for this device
6. Wait for sync to complete

#### If you only have the recovery QR:

1. On new device, open TrichoApp
2. Tap **"Recover Account"**
3. Scan your recovery QR code (or enter text backup)
4. Enter your email address
5. Register a new passkey
6. Your data syncs from the cloud

### Sync Troubleshooting

| Problem | Solution |
|---------|----------|
| "Offline" but have internet | Pull down to refresh, check Settings → Sync |
| Sync stuck | Close and reopen the app |
| Changes not appearing | Wait a moment, tap Sync Now |
| Photo not syncing | Large photos take longer, check upload queue |

---

## Account Recovery

### When You Need Recovery

You'll need your Recovery QR code when:
- 📱 Your device is lost or stolen
- 🔄 Your device was factory reset
- 🔑 Your passkey stopped working
- ➕ Setting up TrichoApp on a new device

### Recovery Process

1. Open TrichoApp on your device
2. Tap **"Recover Account"**
3. **Scan method:**
   - Point your camera at the recovery QR code
   - Or tap **"Enter manually"** to type the backup code
4. Wait for validation
5. Enter your email address
6. Register a new passkey for this device
7. Your data syncs automatically

### If Your Passkey Doesn't Work

Sometimes passkeys can stop working if:
- You updated your device's biometrics (new fingerprint, Face ID reset)
- iOS/Android security settings changed
- The passkey was deleted in device settings

**Solution:**
1. On the login screen, tap **"Use Recovery Code"**
2. Scan your recovery QR
3. Register a new passkey

### Viewing Your Recovery Code (While Logged In)

If you can access the app but want to view your recovery code:

1. Open **Settings** (⚙️)
2. Tap **Security**
3. Tap **"Show Recovery Code"**
4. Verify with your passkey
5. Your recovery QR is displayed

**Tip:** Save it again if you didn't before!

### Lost Everything?

**If you lost BOTH your device AND recovery code:**

Unfortunately, your data cannot be recovered. This is the security tradeoff of end-to-end encryption:
- Only YOU can access your data
- No "forgot password" option
- No backdoor for support

**This is why saving the recovery code is so important!**

---

## Settings

### Accessing Settings

Tap the **gear icon (⚙️)** in the top-right corner of the home screen.

### Account Settings

| Option | Description |
|--------|-------------|
| **Email** | Your registered email address |
| **Passkeys** | View and manage registered passkeys |
| **Recovery Code** | View your recovery QR |
| **Logout** | Lock the app (doesn't delete data) |
| **Delete Account** | Permanently delete all data |

### Sync Settings

| Option | Description |
|--------|-------------|
| **Sync Status** | Current sync state |
| **Last Synced** | When data was last synced |
| **Pending Changes** | Number of unsynced changes |
| **Sync Now** | Force immediate sync |

### Photo Settings

| Option | Description |
|--------|-------------|
| **Quality** | High (best detail), Medium (recommended), Low (smaller files) |
| **Camera** | Default camera (front/back) |

### Storage Settings

| Option | Description |
|--------|-------------|
| **Local Storage Used** | Space used by app data |
| **Clear Cache** | Remove temporary files |

### About

| Option | Description |
|--------|-------------|
| **Version** | App version number |
| **Support** | Contact information |
| **Privacy Policy** | How we handle data |
| **Terms of Service** | Usage agreement |

---

## Troubleshooting

### App Won't Open

**Try these steps:**
1. Close the app completely
2. Reopen from home screen
3. If using browser, clear cache and reload
4. Reinstall the app

### Can't Login with Passkey

1. **Check biometrics:**
   - Is Face ID / fingerprint working in other apps?
   - Try using device PIN instead

2. **Passkey might be deleted:**
   - Go to device Settings → Passwords/Security
   - Check if TrichoApp passkey exists

3. **Use recovery:**
   - Tap "Use Recovery Code"
   - Scan your recovery QR
   - Register new passkey

### Sync Not Working

1. **Check connection:**
   - Is WiFi/cellular working?
   - Can you browse other websites?

2. **Try manual sync:**
   - Settings → Sync → Sync Now

3. **Wait and retry:**
   - Server might be temporarily busy
   - Try again in a few minutes

### Photos Not Uploading

1. **Check status:**
   - Look for pending upload indicator
   - Large photos take longer

2. **Check connection:**
   - Photos need good connection to upload

3. **Force upload:**
   - Settings → Sync → Sync Now

### App is Slow

1. **Clear cache:**
   - Settings → Storage → Clear Cache

2. **Reduce photos:**
   - Lower photo quality in settings

3. **Check storage:**
   - Ensure device has free space

### Data Missing After Sync

1. **Wait for full sync:**
   - Large databases take time
   - Check sync progress

2. **Force sync:**
   - Pull down to refresh
   - Settings → Sync Now

3. **Check other device:**
   - Ensure changes were saved
   - Check sync status there

---

## FAQ

### Security & Privacy

**Q: Is my data really encrypted?**
A: Yes! All data is encrypted with AES-256-GCM on your device before sending anywhere. The server only sees encrypted blobs.

**Q: Can TrichoApp see my customer data?**
A: No. End-to-end encryption means only YOU can decrypt and read your data. We have no way to access it.

**Q: What if TrichoApp gets hacked?**
A: Attackers would only get encrypted data they cannot read. Your data remains secure.

**Q: Can law enforcement access my data?**
A: We can only provide encrypted data which is unreadable without your recovery code.

### Passkeys & Recovery

**Q: What if I forget my passkey?**
A: Passkeys use biometrics (Face ID, fingerprint) - there's nothing to forget! If it stops working, use your recovery QR.

**Q: Can I have multiple passkeys?**
A: Yes! Each device you set up gets its own passkey.

**Q: What happens to my passkey if I get a new phone?**
A: Passkeys are tied to devices. Set up your new phone using the recovery QR code.

### Multi-Device

**Q: Can I use TrichoApp on multiple devices?**
A: Yes! Set up each device using your recovery QR code.

**Q: Which device is the "main" device?**
A: There's no main device - all devices are equal and stay synced.

**Q: What if I make changes on two devices at once?**
A: The app uses "last write wins" - the most recent change is kept.

### Offline Use

**Q: Does TrichoApp work offline?**
A: Yes! Create customers, record visits, take photos - all work offline.

**Q: How do I know if I'm offline?**
A: The status bar shows "Offline" when there's no connection.

**Q: What happens when I go back online?**
A: Changes sync automatically when connection is restored.

### Data & Storage

**Q: Is there a limit on customers/photos?**
A: No hard limit, but recommended: ~1000 customers, ~10 photos per customer.

**Q: How do I export my data?**
A: Currently via recovery code. Full export feature coming soon.

**Q: How do I delete all my data?**
A: Settings → Account → Delete Account. This is permanent!

### Account

**Q: Can I change my email?**
A: Contact support to change your registered email.

**Q: Can I transfer my account?**
A: Share your recovery QR code (carefully!) to let someone else access the account.

---

## Privacy & Security

### What Data We Collect

| Data Type | Stored Where | Who Can Read |
|-----------|--------------|--------------|
| Encrypted customer data | Our servers | Only you (with DEK) |
| Encrypted photos | Our servers | Only you (with DEK) |
| Your email | Our servers | Us (for account management) |
| Passkey public keys | Our servers | Anyone (they're public) |

### What We DON'T Collect

- ❌ Your recovery secret
- ❌ Your encryption keys
- ❌ Unencrypted customer data
- ❌ Unencrypted photos
- ❌ Device passwords/PINs
- ❌ Biometric data

### Data Retention

- **Active accounts:** Data stored indefinitely
- **Deleted accounts:** Data removed within 30 days
- **Sync logs:** Retained for 90 days

### GDPR Compliance

- You can request data export
- You can request data deletion
- You control your encryption keys
- We cannot access your data content

---

## Getting Help

### Self-Help Resources

1. Re-read this User Guide
2. Check the FAQ section
3. Check Settings → About for version info

### Contact Support

**Email:** support@tricho.app

**Include:**
- Your email address
- Device type (iPhone, Android, etc.)
- App version
- Description of the problem
- Screenshots if relevant

**Note:** We cannot access your data, so never send customer information!

### Updates & News

- Follow us for updates on new features
- Check the app periodically for updates

---

## Quick Reference Card

### Key Actions

| Action | How To |
|--------|--------|
| Add customer | Home → + Add Customer |
| Search | Tap search bar, type name |
| Add visit | Customer → + Add Visit |
| Take photo | Customer → + Add Photo |
| Sync now | Settings → Sync → Sync Now |
| View recovery code | Settings → Security → Show Recovery |
| Lock app | Settings → Account → Logout |

### Keyboard Shortcuts (Desktop)

| Shortcut | Action |
|----------|--------|
| Ctrl/Cmd + N | New customer |
| Ctrl/Cmd + F | Search |
| Ctrl/Cmd + S | Save |
| Escape | Cancel / Close |

---

**Remember:** Your Recovery QR code is the key to your data. Keep it safe!

*TrichoApp - Your customers' data, encrypted and secure.*
