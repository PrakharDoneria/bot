const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const path = require('path');
const fetch = require('node-fetch');

// Function to generate a random string
function generateRandomString(length) {
    return crypto.randomBytes(length).toString('hex');
}

// Bot token
const token = 'YOUR_BOT_TOKEN';
const bot = new TelegramBot(token, { polling: true });

// Admin's Telegram ID
const adminId = 'YOUR_ADMIN_TELEGRAM_ID';

// Variable to store the file ID of the uploaded ZIP file
let zipFileId = null;

// Object to keep track of users awaiting URL input
let awaitingURLFromUser = {};

// Initialize SQLite database
const db = new sqlite3.Database('users.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error(err.message);
    } else {
        console.log('Connected to the SQLite database.');
        // Create the 'users' table if it does not exist
        db.run("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT, count INTEGER DEFAULT 0, start_message_sent INTEGER DEFAULT 0)", err => {
            if (err) {
                console.error("Error creating users table:", err.message);
            }
        });
    }
});

// Handle new members joining the group
bot.on('message', (msg) => {
    if (msg.new_chat_members) {
        msg.new_chat_members.forEach((member) => {
            const welcomeMessage = `Hi ${member.first_name}!, Welcome to SAIGA CHAT GROUP`;
            bot.sendMessage(msg.chat.id, welcomeMessage).then((sentMessage) => {
                setTimeout(() => {
                    bot.deleteMessage(sentMessage.chat.id, sentMessage.message_id).catch(console.error);
                }, 10000); // Delete welcome message after 10 seconds
            });
        });
        setTimeout(() => {
            bot.deleteMessage(msg.chat.id, msg.message_id).catch(console.error);
        }, 12000); // Delete join message after 12 seconds
    }
});

// Function to check if a user is an admin
function isAdmin(userId) {
    return userId.toString() === adminId;
}

// Handle /start command
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const username = msg.from.username || '';

    db.get("SELECT start_message_sent FROM users WHERE id = ?", [userId], (err, row) => {
        if (err) {
            console.error(err.message);
            bot.sendMessage(chatId, "Error checking user info.");
        } else {
            if (row && row.start_message_sent) {
                console.log("Start message already sent to this user.");
            } else {
                const welcomeMessage = username ? `🇨🇭 集` : '🇨🇭 集';
                bot.sendMessage(chatId, welcomeMessage).then(() => {
                    db.run("INSERT INTO users (id, username, count, start_message_sent) VALUES (?, ?, 0, 1) ON CONFLICT(id) DO UPDATE SET start_message_sent = 1", [userId, username], function(err) {
                        if (err) console.error("Database error on updating start_message_sent: ", err.message);
                        else console.log(`Start message sent and flag updated for user ${userId}.`);
                    });
                });
            }
        }
    });
});

// Handle admin replies
bot.on('message', (msg) => {
    if (msg.from.id.toString() === adminId && msg.reply_to_message) {
        if (msg.text === '/sendzip') {
            const match = msg.reply_to_message.text.match(/\(ID: (\d+)\):/);
            if (match) {
                const originalSenderId = match[1];
                if (zipFileId) {
                    bot.sendDocument(originalSenderId, zipFileId)
                        .then(() => {
                            bot.sendMessage(adminId, `ZIP file sent to user ID: ${originalSenderId}`);
                        })
                        .catch(error => {
                            console.error('Error sending ZIP file:', error);
                            bot.sendMessage(adminId, `Failed to send ZIP file to user ID: ${originalSenderId}`);
                        });
                } else {
                    bot.sendMessage(adminId, 'ZIP file ID not set. Please upload a ZIP file first.');
                }
            }
        }
    }
});

// Handle admin command to upload a ZIP file
bot.onText(/\/upload_zip/, (msg) => {
    const userId = msg.from.id.toString();
    if (!isAdmin(userId)) {
        bot.sendMessage(userId, 'You do not have permission to use this command.');
        return;
    }
    if (msg.document) {
        const fileId = msg.document.file_id;
        const mimeType = msg.document.mime_type;
        if (mimeType === 'application/zip' || mimeType === 'application/x-zip-compressed') {
            zipFileId = fileId;
            bot.sendMessage(userId, 'ZIP file uploaded and saved successfully.');
        } else {
            bot.sendMessage(userId, 'Please upload a ZIP file.');
        }
    } else {
        bot.sendMessage(userId, 'Please send a ZIP file with this command.');
    }
});

// Handle admin command to reset user count
bot.onText(/\/reset_limit (\d+) (\d+|unlimited)/, (msg, match) => {
    const adminUserId = msg.from.id.toString();
    const targetUserId = match[1];
    let newCount = match[2];
    if (!isAdmin(adminUserId)) {
        bot.sendMessage(adminUserId, 'You do not have permission to use this command.');
        return;
    }
    if (newCount.toLowerCase() === 'unlimited') {
        newCount = 999999;
    } else {
        newCount = parseInt(newCount, 10);
    }
    db.run("UPDATE users SET count = ? WHERE id = ?", [newCount, targetUserId], function(err) {
        if (err) {
            console.error(err.message);
            bot.sendMessage(adminUserId, 'Failed to update count.');
        } else {
            bot.sendMessage(adminUserId, `Count for user ${targetUserId} has been updated to ${newCount}.`);
            bot.sendMessage(targetUserId, `Your count has been updated. You now have ${newCount} counts available.`).catch(err => {
                console.error("Failed to send notification to the user:", err);
                bot.sendMessage(adminUserId, `Failed to notify user ${targetUserId} about their updated count.`);
            });
        }
    });
});

// Handle button presses
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const userId = callbackQuery.from.id.toString();
    const username = callbackQuery.from.username;
    switch (data) {
        case 'activate_key':
            // Handle activate key logic here
            db.get("SELECT count FROM users WHERE id = ?", userId, (err, row) => {
                if (err) {
                    console.error(err.message);
                    bot.sendMessage(userId, 'An error occurred.');
                    return;
                }
                if (row && row.count > 0) {
                    bot.sendMessage(userId, 'Key activated successfully.');
                    db.run("UPDATE users SET count = count - 1 WHERE id = ?", userId, function(err) {
                        if (err) console.error("Error updating user count after key activation:", err.message);
                    });
                } else {
                    bot.sendMessage(userId, 'You have no more activations left.');
                }
            });
            break;
        case 'get_url':
            // Ask the user for a URL
            awaitingURLFromUser[userId] = true;
            bot.sendMessage(userId, 'Please send me the URL you want to process:');
            break;
        default:
            bot.sendMessage(userId, 'Invalid option selected.');
    }
});

// Handle URLs sent by users
bot.on('message', async (msg) => {
    const userId = msg.from.id.toString();
    const username = msg.from.username;
    const userMessage = msg.text;
    if (awaitingURLFromUser[userId]) {
        delete awaitingURLFromUser[userId];
        // Process the URL here
        bot.sendMessage(userId, 'URL received. Processing...');
        // Example: Fetch the URL title
        try {
            const response = await fetch(userMessage);
            const html = await response.text();
            const titleMatch = html.match(/<title>(.*?)<\/title>/);
            if (titleMatch) {
                const title = titleMatch[1];
                bot.sendMessage(userId, `Title: ${title}`);
            } else {
                bot.sendMessage(userId, 'No title found.');
            }
        } catch (error) {
            console.error('Error fetching URL:', error);
            bot.sendMessage(userId, 'Error processing URL.');
        }
    }
});

// Handle /help command
bot.onText(/\/help/, (msg) => {
    const userId = msg.from.id.toString();
    const helpMessage = `
Available commands:
/start - Start the bot
/reset_limit <user_id> <count/unlimited> - Reset the activation count for a user
/upload_zip - Upload a ZIP file
/help - Display this help message
`;
    bot.sendMessage(userId, helpMessage);
});
