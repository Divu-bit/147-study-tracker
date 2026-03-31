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

// ─── Utility ─────────────────────────────────

function getToday() {
    // Use IST timezone for date calculations
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(d1, d2) {
    return Math.round((new Date(d2 + 'T00:00:00') - new Date(d1 + 'T00:00:00')) / (1000 * 60 * 60 * 24));
}

// ─── Telegram Bot Handlers ───────────────────

bot.onText(/\/start (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const linkCode = match[1];

    try {
        const newUser = await User.findOne({ linkCode });
        if (!newUser) {
            return await bot.sendMessage(chatId, '❌ Invalid link code. Please use the link from the website.');
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

// Check if a link code has been connected to Telegram
app.get('/api/link-status/:code', async (req, res) => {
    try {
        const user = await User.findOne({ linkCode: req.params.code });
        if (!user) return res.status(404).json({ error: 'Not found' });
        res.json({ linked: user.linked });
    } catch (error) {
        res.status(500).json({ error: 'Failed to check status' });
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
        let notified = 0;

        for (const user of users) {
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
                notified++;
            } catch (e) {
                console.error(`  ❌ Failed to notify user ${user.linkCode}:`, e.message);
            }
        }

        res.json({ success: true, date: today, usersNotified: notified, totalUsers: users.length });
        console.log(`  ✅ Notified ${notified}/${users.length} users`);
    } catch (error) {
        console.error('Cron error:', error);
        res.status(500).json({ error: 'Notification failed' });
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
