# Supabase Setup Guide - History Saving Fix

## ❌ Problem: History Not Saving

This happens when:
1. **RLS (Row Level Security) is blocking inserts** ← Most common
2. **Database tables don't exist**
3. **User ID mismatch**

---

## ✅ Solution - Follow These Steps:

### **Step 1: Create Database Tables**

1. Go to: https://app.supabase.com
2. Select your project
3. Click **"SQL Editor"** in left sidebar
4. Click **"New Query"**
5. Copy and paste this SQL:

```sql
-- Create Users table
CREATE TABLE IF NOT EXISTS "Users" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ DEFAULT now(),
    "updatedAt" TIMESTAMPTZ DEFAULT now()
);

-- Create Prescriptions table
CREATE TABLE IF NOT EXISTS "Prescriptions" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "userId" UUID NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
    summary TEXT,
    diagnosis TEXT,
    medications JSONB DEFAULT '[]'::jsonb,
    "side_effects" JSONB DEFAULT '[]'::jsonb,
    "follow_up" JSONB DEFAULT '[]'::jsonb,
    "rawText" TEXT,
    "createdAt" TIMESTAMPTZ DEFAULT now(),
    "updatedAt" TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for faster queries
CREATE INDEX idx_prescriptions_userId ON "Prescriptions"("userId");
CREATE INDEX idx_prescriptions_createdAt ON "Prescriptions"("createdAt");
```

6. Click **"Run"** button

✅ Tables should now be created

---

### **Step 2: Disable RLS (Row Level Security) for Testing**

1. In Supabase dashboard, click **"Authentication"** in left sidebar
2. Click **"Policies"**
3. Select **"Prescriptions"** table
4. Click the **"..."** menu
5. Click **"Disable RLS"** (this allows unauthenticated access for testing)

> ⚠️ **WARNING**: Only do this for testing! For production, set up proper RLS policies.

---

### **Step 3: Update .env File**

Make sure your `.env` has these variables set:

```env
PORT=5000
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
JWT_SECRET=YOUR_LONG_RANDOM_JWT_SECRET
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
```

Never commit `.env` to GitHub. Keep real keys only in your local environment or deployment secrets.

---

### **Step 4: Restart Server**

```bash
# Stop server with Ctrl+C
# Then run:
npm start
```

---

## 🧪 Testing History Saving:

1. Open http://localhost:5000
2. **Sign Up** with a new email
3. After signing in:
   - Upload a prescription
   - Wait for analysis to complete
   - Open browser **Developer Tools** (F12)
4. Check **Console** tab for messages:
   ```
   ✅ Successfully saved prescription for user: abc123
   ✅ Fetched 5 prescription records
   ```
5. Go to **History** tab - should show your prescription ✅

---

## 🐛 Debugging Console Errors:

### **Error: "insert or update on table "Prescriptions" violates foreign key constraint"**
- Fix: RLS is still enabled, disable it as per Step 2

### **Error: "permission denied for schema public"**
- Fix: User doesn't have permissions, check RLS is disabled

### **Error: "Failed to save prescription: undefined"**
- Fix: Check Supabase URL and KEY in .env file

### **No error but history shows 0 records**
- Fix: Tables might not exist, run SQL from Step 1 again

---

## ✅ Tab Bar Behavior (Fixed):

- **Analyze page**: Tab bar stays sticky at top ✅
- **Results/Schedule/History**: Tab bar scrolls with content ✅

---

## 📞 Still Not Working?

Check the server console output for error messages. Share any errors that look like:
```
❌ Database insert error: ...
❌ Supabase select error: ...
```

These will tell you exactly what's wrong!
