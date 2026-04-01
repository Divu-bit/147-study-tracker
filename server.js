const express = require('express');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

const User = require('./models/User');
const Entry = require('./models/Entry');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = 'Edu147plannerbot';
const RENDER_URL = process.env.RENDER_URL; // e.g., https://your-app.onrender.com
const CRON_SECRET = process.env.CRON_SECRET || 'default-secret-change-me';
const UNIVERSAL_BRIDGE_API_KEY = process.env.UNIVERSAL_BRIDGE_API_KEY;

// ─── Telegram Bot Setup ──────────────────────
// Use WEBHOOK mode in production (Render), POLLING mode locally
let bot;

if (RENDER_URL) {
    // Production: webhook mode — works even when server sleeps
    // Telegram sends requests TO our server, which wakes it up
    bot = new TelegramBot(BOT_TOKEN);
    const webhookPath = `/bot${BOT_TOKEN}`;
    bot.setWebHook(`${RENDER_URL}${webhookPath}`);
    app.post(webhookPath, (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
    });
    console.log('🤖 Telegram bot running in WEBHOOK mode');
} else {
    // Local dev: polling mode
    bot = new TelegramBot(BOT_TOKEN, { polling: true });
    console.log('🤖 Telegram bot running in POLLING mode (dev)');
}

// Set bot menu commands
bot.setMyCommands([
    { command: 'log', description: 'Log a new study topic' },
    { command: 'cancel', description: 'Cancel current action' }
]).catch(console.error);

// ─── State Tracking for Bot ──────────────────
const userStates = {};

// ─── Utility ─────────────────────────────────

function getToday() {
    // Use IST timezone for date calculations
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(d1, d2) {
    return Math.round((new Date(d2 + 'T00:00:00') - new Date(d1 + 'T00:00:00')) / (1000 * 60 * 60 * 24));
}

// ─── Telegram Bot Handlers ───────────────────

bot.onText(/\/start (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const linkCode = match[1].trim();

    if (linkCode === 'null' || linkCode === 'undefined' || !linkCode) {
        return await bot.sendMessage(chatId, '❌ Website connection error. Your browser failed to provide a valid link code. Please refresh the website and try again.');
    }

    try {
        const newUser = await User.findOne({ linkCode });
        if (!newUser) {
            return await bot.sendMessage(chatId, '❌ Invalid link code. Please use the exact link provided on the website.');
        }

        // Check if this Telegram account was previously linked to a DIFFERENT linkCode
        const existingUser = await User.findOne({ chatId, linked: true, linkCode: { $ne: linkCode } });

        if (existingUser) {
            // Migrate all entries from old linkCode → new linkCode
            const migrated = await Entry.updateMany(
                { linkCode: existingUser.linkCode },
                { $set: { linkCode: linkCode } }
            );

            // Delete old user record
            await User.deleteOne({ _id: existingUser._id });

            // Link new user
            newUser.chatId = chatId;
            newUser.linked = true;
            newUser.linkedAt = new Date();
            await newUser.save();

            const totalEntries = await Entry.countDocuments({ linkCode });
            await bot.sendMessage(chatId,
                `✅ *Re-linked successfully!*\n\n` +
                `Your previous data (${totalEntries} topic${totalEntries !== 1 ? 's' : ''}) has been restored.\n\n` +
                `📚 Head back to the website — all your entries are there!`,
                { parse_mode: 'Markdown' }
            );
            console.log(`🔄 Migrated ${migrated.modifiedCount} entries for chatId ${chatId}`);
        } else {
            // First time linking (or same linkCode)
            newUser.chatId = chatId;
            newUser.linked = true;
            newUser.linkedAt = new Date();
            await newUser.save();

            await bot.sendMessage(chatId,
                '✅ *Linked successfully!*\n\n' +
                'You\'re all set! You will receive daily revision reminders here at 8:00 AM.\n\n' +
                '📚 Head back to the website and start logging your study topics!',
                { parse_mode: 'Markdown' }
            );
        }
    } catch (error) {
        console.error('Error linking user:', error);
        await bot.sendMessage(chatId, '⚠️ Something went wrong. Please try again.');
    }
});

bot.onText(/^\/start$/, async (msg) => {
    await bot.sendMessage(msg.chat.id,
        '👋 Welcome to *147 Study Bot*!\n\n' +
        'This bot sends you daily revision reminders based on the 1-4-7 spaced repetition method.\n\n' +
        '🔗 Please use the link from the website to connect your account.',
        { parse_mode: 'Markdown' }
    );
});

bot.onText(/^\/cancel$/, async (msg) => {
    const chatId = msg.chat.id;
    if (userStates[chatId]) {
        delete userStates[chatId];
        await bot.sendMessage(chatId, '🚫 Logging cancelled.', { reply_markup: { remove_keyboard: true } });
    } else {
        await bot.sendMessage(chatId, 'Nothing to cancel.');
    }
});

bot.onText(/^\/log$/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
        const user = await User.findOne({ chatId, linked: true });
        if (!user) {
            return await bot.sendMessage(chatId, '❌ You need to link your account first! Please use the link on the website.');
        }

        userStates[chatId] = { step: 'subject', linkCode: user.linkCode };
        await bot.sendMessage(chatId, '📝 *Let\'s log a study topic!*\n\nWhat *Subject* did you study?', { parse_mode: 'Markdown' });
    } catch (e) {
        console.error('Error starting log:', e);
    }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Ignore commands manually
    if (!text || text.startsWith('/')) return;

    const state = userStates[chatId];
    if (!state) return; // Not in a conversation

    // Strip markdown chars so they don't break our bot formatting
    const safeText = text.trim().replace(/[*_`\[\]()]/g, '');

    try {
        if (state.step === 'subject') {
            state.subject = safeText;
            state.step = 'topic';
            await bot.sendMessage(chatId, `Got it. Subject: *${state.subject}*\n\nWhat *Topic / Chapter* did you cover?`, { parse_mode: 'Markdown' });
        } 
        else if (state.step === 'topic') {
            state.topic = safeText;
            state.step = 'notes';
            await bot.sendMessage(chatId, `Great! Topic: *${state.topic}*\n\nAny *Notes*? (Type 'skip' to leave blank)`, { parse_mode: 'Markdown' });
        } 
        else if (state.step === 'notes') {
            const notes = safeText.toLowerCase() === 'skip' ? '' : safeText;
            const today = getToday();
            
            await Entry.create({
                linkCode: state.linkCode,
                date: today,
                subject: state.subject,
                topic: state.topic,
                notes: notes,
                revisions: {
                    day4: { dueDate: addDays(today, 3), completed: false, completedAt: null },
                    day7: { dueDate: addDays(today, 6), completed: false, completedAt: null }
                }
            });

            delete userStates[chatId];

            await bot.sendMessage(chatId, 
                `✅ *Topic logged successfully!*\n\n` +
                `*Subject:* ${state.subject}\n` +
                `*Topic:* ${state.topic}\n\n` +
                `📅 Revisions scheduled for *Day 4* and *Day 7*! You can view this on the website.`,
                { parse_mode: 'Markdown' }
            );
        }
    } catch (error) {
        console.error('Logging flow error:', error);
        delete userStates[chatId];
        await bot.sendMessage(chatId, '⚠️ Something went wrong while saving. Please try again with /log.');
    }
});

// ─── API Routes ──────────────────────────────

// Generate a new link code for a user
app.post('/api/link', async (req, res) => {
    try {
        const linkCode = crypto.randomBytes(8).toString('hex');
        await User.create({ linkCode });
        res.json({ linkCode, botLink: `https://t.me/${BOT_USERNAME}?start=${linkCode}` });
    } catch (error) {
        console.error('Link creation error:', error);
        res.status(500).json({ error: 'Failed to create link' });
    }
});

// Check if a link code has been connected to a device
app.get('/api/link-status/:code', async (req, res) => {
    try {
        const user = await User.findOne({ linkCode: req.params.code });
        if (!user) return res.status(404).json({ error: 'Not found' });
        res.json({ linked: user.linked, preference: user.notificationPreference, notificationTime: user.notificationTime });
    } catch (error) {
        res.status(500).json({ error: 'Failed to check status' });
    }
});

// Link Universal Bridge App
app.post('/api/link-app', async (req, res) => {
    try {
        const { linkCode, appUserId } = req.body;
        
        // 1. Check if this appUserId is ALREADY attached to an account
        const existingAppUser = await User.findOne({ appUserId, linked: true });
        
        if (existingAppUser && existingAppUser.linkCode !== linkCode) {
            // Return existing link code so device can sync/login
            return res.json({ success: true, isLogin: true, existingLinkCode: existingAppUser.linkCode });
        }

        const user = await User.findOne({ linkCode });
        if (!user) return res.status(404).json({ error: 'Not found' });

        user.appUserId = appUserId;
        user.notificationPreference = 'app';
        user.linked = true;
        user.linkedAt = new Date();
        await user.save();
        res.json({ success: true });
    } catch (error) {
        console.error('App link error:', error);
        res.status(500).json({ error: 'Failed to link app' });
    }
});

// Update user settings
app.put('/api/user/settings', async (req, res) => {
    try {
        const { linkCode, notificationTime } = req.body;
        const user = await User.findOne({ linkCode });
        if (!user) return res.status(404).json({ error: 'Not found' });
        
        if (notificationTime) user.notificationTime = notificationTime;
        await user.save();
        
        res.json({ success: true, notificationTime: user.notificationTime });
    } catch (e) {
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// Get all entries for a user
app.get('/api/entries/:code', async (req, res) => {
    try {
        const entries = await Entry.find({ linkCode: req.params.code }).sort({ createdAt: -1 });
        res.json(entries);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch entries' });
    }
});

// Add a new study entry
app.post('/api/entries', async (req, res) => {
    try {
        const { linkCode, date, subject, topic, notes, revisions } = req.body;
        const entry = await Entry.create({ linkCode, date, subject, topic, notes, revisions });
        res.json(entry);
    } catch (error) {
        console.error('Entry creation error:', error);
        res.status(500).json({ error: 'Failed to create entry' });
    }
});

// Mark a revision as complete
app.put('/api/entries/:code/:id/revise', async (req, res) => {
    try {
        const { type } = req.body;
        const entry = await Entry.findOne({ _id: req.params.id, linkCode: req.params.code });
        if (!entry) return res.status(404).json({ error: 'Not found' });

        entry.revisions[type].completed = true;
        entry.revisions[type].completedAt = new Date();
        await entry.save();
        res.json(entry);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update entry' });
    }
});

// Delete an entry
app.delete('/api/entries/:code/:id', async (req, res) => {
    try {
        await Entry.findOneAndDelete({ _id: req.params.id, linkCode: req.params.code });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete entry' });
    }
});

// Delete account — unlink Telegram + wipe all data
app.delete('/api/account/:code', async (req, res) => {
    try {
        const deleted = await Entry.deleteMany({ linkCode: req.params.code });
        await User.findOneAndDelete({ linkCode: req.params.code });
        console.log(`🗑️ Account deleted: ${req.params.code} (${deleted.deletedCount} entries wiped)`);
        res.json({ success: true, entriesDeleted: deleted.deletedCount });
    } catch (error) {
        console.error('Account deletion error:', error);
        res.status(500).json({ error: 'Failed to delete account' });
    }
});

// ─── Cron Endpoint (called by external cron service) ────

app.get('/api/cron/notify', async (req, res) => {
    // Verify secret to prevent abuse
    const secret = req.query.secret || req.headers['x-cron-secret'];
    if (secret !== CRON_SECRET) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    console.log(`[${new Date().toISOString()}] Cron notification triggered`);

    try {
        const users = await User.find({ linked: true });
        const today = getToday();
        const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const currentTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        
        let notified = 0;

        for (const user of users) {
            if (user.lastNotifiedDate === today) continue; // Already notified today
            
            const userTime = user.notificationTime || '09:00';
            if (currentTime < userTime) continue; // Not time yet

            const entries = await Entry.find({ linkCode: user.linkCode });
            const dueToday = [];
            const overdue = [];

            entries.forEach(entry => {
                const d4 = entry.revisions.day4;
                const d7 = entry.revisions.day7;
                if (d4.dueDate === today && !d4.completed) dueToday.push({ entry, type: 'day4' });
                if (d7.dueDate === today && !d7.completed) dueToday.push({ entry, type: 'day7' });
                if (d4.dueDate < today && !d4.completed) overdue.push({ entry, type: 'day4', days: daysBetween(d4.dueDate, today) });
                if (d7.dueDate < today && !d7.completed) overdue.push({ entry, type: 'day7', days: daysBetween(d7.dueDate, today) });
            });

            if (dueToday.length === 0 && overdue.length === 0) continue;

            const totalCount = dueToday.length + overdue.length;
            const webhookBase = RENDER_URL || 'http://localhost:3000'; // fallback for local

            if (user.notificationPreference === 'app') {
                // Universal Bridge App specific payload
                if (!user.appUserId || !UNIVERSAL_BRIDGE_API_KEY) {
                    console.error('Missing appUserId or API key for user:', user.linkCode);
                    continue;
                }

                const schema = [
                    { type: 'display_text', label: `You have ${totalCount} topics pending revision today.` },
                    { type: 'button', label: '✅ Mark Due Revisions Done', action: 'mark_done', webhookUrl: `${webhookBase}/api/bridge-webhook?code=${user.linkCode}` },
                    { type: 'display_text', label: '--- Log New Topic ---' },
                    { type: 'text_input', id: 'subject', label: 'Subject' },
                    { type: 'text_input', id: 'topic', label: 'Topic / Chapter' },
                    { type: 'text_input', id: 'notes', label: 'Notes (Optional)' },
                    { type: 'button', label: '📝 Log New Topic', action: 'log_topic', webhookUrl: `${webhookBase}/api/bridge-webhook?code=${user.linkCode}` }
                ];

                try {
                    const response = await fetch('https://universal-bridge.onrender.com/api/notify', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-api-key': UNIVERSAL_BRIDGE_API_KEY
                        },
                        body: JSON.stringify({
                            targetUserId: user.appUserId,
                            title: '📚 147 Study - Revisions Due!',
                            body: `You have ${totalCount} topics waiting for your review.`,
                            interactiveSchema: schema
                        })
                    });
                    
                    if (!response.ok) throw new Error(`Status ${response.status}`);
                    user.lastNotifiedDate = today;
                    await user.save();
                    notified++;
                } catch (e) {
                    console.error(`  ❌ Failed to notify app user ${user.linkCode}:`, e.message);
                }

            } else {
                // Telegram specific payload
                let msg = '📚 *147 Study — Today\'s Revisions*\n\n';
                const d4Items = dueToday.filter(i => i.type === 'day4');
                const d7Items = dueToday.filter(i => i.type === 'day7');

                if (d4Items.length) {
                    msg += '🟣 *Day 4 Revisions:*\n';
                    d4Items.forEach(i => { msg += `  • ${i.entry.subject} — ${i.entry.topic}\n`; });
                    msg += '\n';
                }
                if (d7Items.length) {
                    msg += '🔵 *Day 7 Revisions:*\n';
                    d7Items.forEach(i => { msg += `  • ${i.entry.subject} — ${i.entry.topic}\n`; });
                    msg += '\n';
                }
                if (overdue.length) {
                    msg += '🔴 *Overdue:*\n';
                    overdue.forEach(i => { msg += `  • ${i.entry.subject} — ${i.entry.topic} (${i.days}d overdue)\n`; });
                    msg += '\n';
                }
                msg += '💪 Good luck with your revisions!';

                try {
                    await bot.sendMessage(user.chatId, msg, { parse_mode: 'Markdown' });
                    user.lastNotifiedDate = today;
                    await user.save();
                    notified++;
                } catch (e) {
                    console.error(`  ❌ Failed to notify telegram user ${user.linkCode}:`, e.message);
                }
            }
        }

        res.json({ success: true, date: today, usersNotified: notified, totalUsers: users.length });
        console.log(`  ✅ Notified ${notified}/${users.length} users`);
    } catch (error) {
        console.error('Cron error:', error);
        res.status(500).json({ error: 'Notification failed' });
    }
});

// ─── TEMP: TEST NOTIFICATION ENDPOINT ─────────
app.get('/api/test-notify/:code', async (req, res) => {
    try {
        const user = await User.findOne({ linkCode: req.params.code });
        if (!user || (!user.linked && !user.appUserId)) {
             return res.status(404).json({ error: 'User not found or not linked' });
        }
        
        if (user.notificationPreference === 'app') {
            const webhookBase = RENDER_URL || 'http://localhost:3000';
            const schema = [
                { type: 'display_text', label: `🛠️ This is a manual test notification.` },
                { type: 'button', label: '✅ I received it!', action: 'test_action', webhookUrl: `${webhookBase}/api/bridge-webhook?code=${user.linkCode}` },
            ];

            const response = await fetch('https://universal-bridge.onrender.com/api/notify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': UNIVERSAL_BRIDGE_API_KEY
                },
                body: JSON.stringify({
                    targetUserId: user.appUserId,
                    title: '🛠️ Test Notification',
                    body: `Your cron integration test is successful.`,
                    interactiveSchema: schema
                })
            });
            const responseData = await response.json();
            return res.json({ success: true, API_Status: response.status, API_Response: responseData });
        } else {
            await bot.sendMessage(user.chatId, '🛠️ *TEST NOTIFICATION*\n\nYour cron integration is working perfectly!', { parse_mode: 'Markdown' });
            return res.json({ success: true, type: 'Telegram' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── Universal Bridge Webhook Endpoint ────────
app.post('/api/bridge-webhook', async (req, res) => {
    const { code } = req.query;
    const { action, data } = req.body;

    if (!code) return res.status(400).json({ error: 'Missing code' });

    console.log(`[Webhook] Received action '${action}' for linkCode '${code}'`);

    try {
        const user = await User.findOne({ linkCode: code });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const today = getToday();

        if (action === 'mark_done') {
            const entries = await Entry.find({ linkCode: code });
            let markedCount = 0;

            for (const entry of entries) {
                let saved = false;
                if (entry.revisions.day4.dueDate <= today && !entry.revisions.day4.completed) {
                    entry.revisions.day4.completed = true;
                    entry.revisions.day4.completedAt = new Date();
                    saved = true;
                }
                if (entry.revisions.day7.dueDate <= today && !entry.revisions.day7.completed) {
                    entry.revisions.day7.completed = true;
                    entry.revisions.day7.completedAt = new Date();
                    saved = true;
                }
                if (saved) {
                    await entry.save();
                    markedCount++;
                }
            }
            console.log(`[Webhook] Marked ${markedCount} revisions as done for ${code}`);
            res.json({ success: true, message: `Marked ${markedCount} topics done.` });
        } 
        else if (action === 'log_topic') {
            const subject = (data.subject || '').trim();
            const topic = (data.topic || '').trim();
            const notes = (data.notes || '').trim() === 'skip' ? '' : (data.notes || '').trim();

            if (!subject || !topic) {
                console.log('[Webhook] Missing subject or topic.');
                return res.json({ success: false, message: 'Subject and Topic are required.' });
            }

            await Entry.create({
                linkCode: code,
                date: today,
                subject: subject,
                topic: topic,
                notes: notes,
                revisions: {
                    day4: { dueDate: addDays(today, 3), completed: false, completedAt: null },
                    day7: { dueDate: addDays(today, 6), completed: false, completedAt: null }
                }
            });

            console.log(`[Webhook] Created new entry for ${code}: ${subject} - ${topic}`);
            res.json({ success: true, message: `Topic logged successfully!` });
        } else if (action === 'test_action') {
            console.log(`[Webhook] Handled test action for ${code}`);
            res.json({ success: true, message: 'Webhook connected properly!' });
        } else {
            res.status(400).json({ error: 'Unknown action' });
        }

    } catch (err) {
        console.error('Webhook processing error:', err);
        res.status(500).json({ error: 'Error processing valid action' });
    }
});

// Health check (keeps Render awake when pinged)
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Fallback: serve index.html for any non-API route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Start Server ────────────────────────────

mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        console.log('✅ Connected to MongoDB');
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
            console.log(`📋 Mode: ${RENDER_URL ? 'PRODUCTION (webhook)' : 'DEVELOPMENT (polling)'}`);
        });
    })
    .catch(err => {
        console.error('❌ MongoDB connection failed:', err.message);
        process.exit(1);
    });
