const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const request = require('request');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const fetch = require('node-fetch');



function generateRandomString(length) {
    return crypto.randomBytes(length).toString('hex');
}

const token = '6823533160:AAEn0g1lOoz_HJV4DFZMPVZhXpjAudYI_c4'; // Replace with your bot token
const bot = new TelegramBot(token, { polling: true });
const adminId = '1860345789'; // Replace with your admin Telegram ID

let zipFileId = null;
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
        
        // Create the 'key_usage_history' table if it does not exist
        db.run(`
            CREATE TABLE IF NOT EXISTS key_usage_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                key TEXT NOT NULL,
                used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `, err => {
            if (err) {
                console.error("Error creating key_usage_history table:", err.message);
            }
        });
    }
});


bot.on('message', (msg) => {
    // Check if the message has new members joining the group
    if (msg.new_chat_members) {
        // Loop through all new members
        msg.new_chat_members.forEach((member) => {
            // Craft a welcome message
            const welcomeMessage = `Hi ${member.first_name}!, Welcome to SAIGA CHAT GROUP`;
            
            // Send the welcome message to the chat
            bot.sendMessage(msg.chat.id, welcomeMessage).then((sentMessage) => {
                // Set a timeout to delete the welcome message after 2 minutes (120000 milliseconds)
                setTimeout(() => {
                    bot.deleteMessage(sentMessage.chat.id, sentMessage.message_id).catch(console.error);
                }, 10000); // 120000 milliseconds = 2 minutes
            });
        });

        // Delete the join message after 2 minutes
        setTimeout(() => {
            bot.deleteMessage(msg.chat.id, msg.message_id).catch(console.error);
        }, 12000); // 120000 milliseconds = 2 minutes
    }
});


  
function isAdmin(userId) {
    return userId.toString() === adminId;
}

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const username = msg.from.username || '';

    // Check if the user exists and if the start message was sent
    db.get("SELECT start_message_sent FROM users WHERE id = ?", [userId], (err, row) => {
        if (err) {
            console.error(err.message);
            bot.sendMessage(chatId, "Error checking user info.");
        } else {
            if (row && row.start_message_sent) {
                // User exists and start message was already sent
                console.log("Start message already sent to this user.");
            } else {
                // User does not exist or start message not sent, handle accordingly
                const welcomeMessage = username ? `🇨🇭 集` : '🇨🇭 集';
                bot.sendMessage(chatId, welcomeMessage).then(() => {
                    // Update or insert user with start_message_sent flag set to 1
                    db.run("INSERT INTO users (id, username, count, start_message_sent) VALUES (?, ?, 0, 1) ON CONFLICT(id) DO UPDATE SET start_message_sent = 1", [userId, username], function(err) {
                        if (err) console.error("Database error on updating start_message_sent: ", err.message);
                        else console.log(`Start message sent and flag updated for user ${userId}.`);
                    });
                });
            }
        }
    });
});



// Handling replies from the admin
bot.on('message', (msg) => {
    if (msg.from.id.toString() === adminId && msg.reply_to_message) {
        // Check if the reply is intended to send the ZIP file
        if (msg.text === '/sendzip') {
            // Extract the original sender's user ID from the forwarded message's text
            const match = msg.reply_to_message.text.match(/\(ID: (\d+)\):/);
            if (match) {
                const originalSenderId = match[1];
                if (zipFileId) { // Check if zipFileId is set
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



// Admin command to upload a ZIP file and save its file_id for later use
bot.onText(/\/upload_zip/, (msg) => {
    const userId = msg.from.id.toString();

    if (!isAdmin(userId)) {
        bot.sendMessage(userId, 'You do not have permission to use this command.');
        return;
    }

    // Ensure the message contains a document (ZIP file)
    if (msg.document) {
        const fileId = msg.document.file_id;
        const mimeType = msg.document.mime_type;

        // Optionally check if the uploaded file is a ZIP by checking its MIME type
        if (mimeType === 'application/zip' || mimeType === 'application/x-zip-compressed') {
            // Store the fileId in the database for later retrieval
            db.run("INSERT OR REPLACE INTO files (id, data) VALUES (?, ?)", [fileId, mimeType], (err) => {
                if (err) {
                    console.error('Error saving file information to database:', err);
                    bot.sendMessage(userId, 'Failed to save ZIP file information.');
                } else {
                    zipFileId = fileId; // Optionally keep this if you need quick access to the last uploaded ZIP
                    bot.sendMessage(userId, 'ZIP file uploaded and saved successfully.');
                }
            });
        } else {
            bot.sendMessage(userId, 'Please upload a ZIP file.');
        }
    } else {
        bot.sendMessage(userId, 'Please send a ZIP file with this command.');
    }
});


bot.onText(/\/reset_limit (\d+) (\d+|unlimited)/, (msg, match) => {
    const adminUserId = msg.from.id.toString();
    const targetUserId = match[1]; // The Telegram ID of the user to update
    let newCount = match[2]; // The new count value, could be a number or 'unlimited'

    // Check if the user issuing the command is an admin
    if (!isAdmin(adminUserId)) {
        bot.sendMessage(adminUserId, 'You do not have permission to use this command.');
        return;
    }

    // Convert 'unlimited' to a specific high value or handle differently if needed
    if (newCount.toLowerCase() === 'unlimited') {
        newCount = 999999; // Example of setting a high value to represent 'unlimited'
    } else {
        newCount = parseInt(newCount, 10); // Ensure newCount is an integer
    }

    // Update the user's count in the database
    db.run("UPDATE users SET count = ? WHERE id = ?", [newCount, targetUserId], function(err) {
        if (err) {
            console.error(err.message);
            bot.sendMessage(adminUserId, 'Failed to update count.');
        } else {
            bot.sendMessage(adminUserId, `Count for user ${targetUserId} has been updated to ${newCount}.`);

            // Additionally, notify the target user about their updated count
            bot.sendMessage(targetUserId, `Your count has been updated. You now have ${newCount} counts available.`).catch(err => {
                console.error("Failed to send notification to the user:", err);
                // Optionally, inform the admin that the user notification failed
                bot.sendMessage(adminUserId, `Failed to notify user ${targetUserId} about their updated count.`);
            });
        }
    });
});


// Handle button presses
bot.on('callback_query', (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const userId = callbackQuery.from.id.toString();
    const username = callbackQuery.from.username;

    switch (data) {
        case 'activate_key':
            // Handle the activate key logic here
            db.get("SELECT count FROM users WHERE id = ?", userId, (err, row) => {
                if (err) {
                    console.error(err.message);
                    bot.sendMessage(userId, 'An error occurred.');
                    return;
                }
                
                if (row && row.count > 0) {
                    bot.sendMessage(userId, '');
                } else {
                }
            });
            break; // Make sure to add break to prevent fall-through

        case 'about_us':
            const aboutUsMessage = `<b>SAIGA Group</b>\n\nWe are a team dedicated to providing top-notch software solutions. Our mission is to enhance your digital experience with innovative and reliable products.\n\n<i>DISCLAIMER:</i>\n\nSAIGA Tools and all its projects were created for research purposes only. By using SAIGA Tools you agree that you take full responsibility for whatever use case. The developer(s) of SAIGA Tools has ZERO responsibility for any actions/results from using SAIGA tools.\n\n- High-quality software products\n- Exceptional customer support\n- Custom solutions tailored to your needs\n\nAdmin @SAIGA_Page\nSupport @SAIGA_Adminbot Active 24/7 ✅\n❤️\n<a href=\"\"></a>`;
            bot.sendMessage(msg.chat.id, aboutUsMessage, { parse_mode: 'HTML' }).catch(error => console.error("Error sending About Us message:", error));
            break;
            break;
            case 'price':
                // Define the image URL
                const imageUrl = 'https://saiga-store-hub.com/s.jpg'; // Replace with the actual image URL
                const htmlCaption = "<b>➡️  SAIGA NODE SENDER 2024 ➡️</b>\n\nSome features to mention:\n\n✅- Inbox to Office365 & Other Domains!\n✅- Embedded Image Letter Sending\n✅- HTML to Image Letter Sending\n✅- HTML to PDF Attachment\n✅- QR and BAR code link embedded in Letter\n✅- Auto Encode name/subject to prevent detection.\n✅- Auto grab #EMAIL for both letter and attachment.\n✅- Auto grab #EMAIL for both name/subject.\n✅- Link to html attachment\n✅- Attachment encode function\n✅- Accept all ports.\n✅- Time sleep between each email sent.\n✅- Free update & Free support.\n✅- Support Windows and Linux ubuntu.\n<b>SAIGA - Mailer: $400 per 5 activations</b>";
            
                // Send the image with an HTML-formatted caption
                bot.sendPhoto(msg.chat.id, imageUrl, {
                    caption: htmlCaption,
                    parse_mode: 'HTML'
                }).catch(error => {
                    console.log("Error sending photo:", error);
                });
                break;
        // Include other cases as necessary
    }
    if (data === 'activate_key') {
        db.get("SELECT count FROM users WHERE id = ?", userId, (err, row) => {
            if (err) {
                console.error(err.message);
                bot.sendMessage(userId, 'An error occurred.');
                return;
            }
            
            if (row && row.count > 0) {
                bot.sendMessage(userId, 'Send me key for activation.');
            } else {
                bot.sendMessage(userId, 'Sorry, you have not been activated 😔');
            }
        });
    } else if (data === 'info') {
        db.get("SELECT count FROM users WHERE id = ?", userId, (err, row) => {
            if (err) {
                console.error(err.message);
                bot.sendMessage(userId, 'An error occurred.', { parse_mode: 'HTML' });
                return;
            }

            // Prepare message content in HTML format including username, chat ID, and remaining keys
            let messageHtml = `<a href="tg://user?id=${userId}">@${username}</a>\n`;
            messageHtml += `<b>Chat ID:</b> ${userId}\n`;
            messageHtml += `<b>Remaining Keys:</b> ${row ? row.count : 0}`;

            // Send message in HTML format
            bot.sendMessage(userId, messageHtml, { parse_mode: 'HTML' });
        });
    } else if (data === 'download_zip') {
        if (!zipFileId) {
            bot.sendMessage(userId, 'No file available for download.');
            return;
        }

        // Example check for user's download count - you might have a different method
        db.get("SELECT count FROM users WHERE id = ?", [userId], (err, row) => {
            if (err) {
                console.error('Error accessing the database:', err);
                bot.sendMessage(userId, 'An error occurred while accessing your download count.');
                return;
            }

            if (row && row.count > 0) {
                // Assuming zipFileId is the file ID of the ZIP file to be downloaded
                bot.sendDocument(userId, zipFileId).then(() => {
                    bot.sendMessage(userId, 'SAIGA 🇨🇭集.');
                    // Optionally decrement the user's count here
                }).catch((error) => {
                    console.error('Failed to send  file:', error);
                    bot.sendMessage(userId, 'Failed to send file.');
                });
            } else {
                bot.sendMessage(userId, 'You do not have any key left.');
            }
        });
    }
    // Handle other callback queries as necessary
});

bot.on('message', (msg) => {
    if (msg.text && msg.text.startsWith('http')) {
        const chatId = msg.chat.id;
        
        const longUrl = msg.text;
        const encodedUrl = encodeURIComponent(longUrl);

        axios.post('https://cleanuri.com/api/v1/shorten', `url=${encodedUrl}`)
            .then(response => {
                if (response.data && response.data.result_url) {
                    // Generate a random string to append
                    const randomString = generateRandomString(7); // Change '10' to any length you prefer
                    
                    // Append the random string to your predefined query
                    const appendQuery = `?${randomString}`;

                    const modifiedUrl = `${response.data.result_url}${appendQuery}`;



                    // Prepare the file content with the shortened URL
                    const textData = `Shortened URL: ${modifiedUrl}`;
                    // Generate a filename using the user's username or a placeholder plus a timestamp
                    const fileName = `${msg.from.username || 'user'}_${Date.now()}.txt`;
                    const filePath = path.join(dataDir, fileName);

                    // Write the file
                    fs.writeFile(filePath, textData, (err) => {
                        if (err) {
                            console.error('Error writing file:', err);
                            bot.sendMessage(chatId, 'Error occurred while creating the URL file.');
                            return;
                        }

                        // Send the document
                        bot.sendDocument(chatId, filePath).then(() => {
                            // Optionally delete the file after sending
                            fs.unlink(filePath, (err) => {
                                if (err) console.error('Error deleting file:', err);
                            });
                        }).catch(error => {
                            console.error('Error sending document:', error);
                            bot.sendMessage(chatId, 'Failed to send the URL file.');
                        });
                    });
                } else {
                    bot.sendMessage(chatId, 'Failed to shorten the URL. Please try again.');
                }
            })
            .catch(error => {
                console.error('Error shortening URL:', error);
                bot.sendMessage(chatId, 'Error occurred while shortening the URL.');
            });
    }
});


bot.on('callback_query', callbackQuery => {
    const data = callbackQuery.data;
    const fromId = callbackQuery.from.id.toString(); // User ID as a string

    if (data === 'url_redirect') {
        // Check the user's count from the database
        db.get("SELECT count FROM users WHERE id = ?", [fromId], (err, row) => {
            if (err) {
                console.error(err.message);
                bot.sendMessage(fromId, 'An error occurred. Please try again.');
                return;
            }

            if (row && row.count > 0) {
                awaitingURLFromUser[fromId] = true; // Mark the user as awaiting a URL
                bot.sendMessage(fromId, "Please send the long URL you'd like to shorten:");
            } else {
                bot.sendMessage(fromId, 'Sorry, you have no counts left to use this feature.');
            }
        });
    }
    // Handle other callback_query data...
});


// Listen for messages
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const username = msg.from.username;
    const text = msg.text;

        // Admin-specific commands
        if (isAdmin(userId)) {
            if (text === '/upload') {
                bot.sendMessage(chatId, 'Please send me the ZIP file.');
            } else if (msg.document) {
                // Admin sends a document
                zipFileId = msg.document.file_id;
                bot.sendMessage(chatId, 'ZIP file uploaded successfully.');
            }
        }
    
        if (isAdmin(userId) && msg.document) {
            saveFile(msg.document.file_id, (err) => {
                if (err) {
                    bot.sendMessage(chatId, 'Failed to save file.');
                } else {
                    bot.sendMessage(chatId, 'File saved successfully.');
                }
            });
        }

    // Store or update the user's username in the database
    if (username) {
        db.run("INSERT OR REPLACE INTO users (id, username, count) VALUES (?, ?, COALESCE((SELECT count FROM users WHERE id = ?), 0))", [userId, username, userId], (err) => {
            if (err) console.error("Database error on updating username: ", err.message);
        });
    }
    const logoUrl = 'http://saiga-store-hub.com/09.jpg'; // Replace with the actual URL to your logo
    

    if (text === '/start') {
        // Insert user with count 0 if not exists and send welcome message
        db.run("INSERT OR IGNORE INTO users (id, username, count) VALUES (?, ?, 0)", [userId, username], function(err) {
            if (err) {
                console.error(err.message);
                bot.sendMessage(chatId, "Error initializing user.");
            } else {
                const options = {
                    reply_markup: JSON.stringify({
                        inline_keyboard: [
                            [{ text: 'Activate Key 🔐', callback_data: 'activate_key' }],
                            [{ text: 'Buy Now 🔥', callback_data: 'buy_more_keys' }],
                            [{ text: 'Download Sender 📥', callback_data: 'download_zip' }],
                            [{ text: 'My - info 📁', callback_data: 'info' }],
                            [{ text: 'Sender - Price \u{1F4B5}', callback_data: 'price' }],
                            [{ text: 'Tutorials 🖥', url: 'https://t.me/c/2048830737/46' }],
                            [{ text: 'SAIGA Channel 👻', url: 'https://t.me/+AJ804KRMqW5lNGJk' }],
                            [{ text: 'Shortener 🔗', callback_data: 'url_redirect' }, { text: 'About Us 🌐', callback_data: 'about_us' }],
                        ]
                    })
                };

                bot.onText(/\/buy_keys/, async (msg) => {
                    const chatId = msg.chat.id;
                    const userId = msg.from.id.toString();
                    const amount = 5; // Set the amount you're charging for the keys
                
                    try {
                        const invoiceData = await createInvoice(userId, amount);
                        if (invoiceData && invoiceData.uuid && invoiceData.link) {
                            const purchaseButton = {
                                reply_markup: JSON.stringify({
                                    inline_keyboard: [
                                        [{ text: 'Pay Now', url: invoiceData.link }],
                                        [{ text: 'Check Payment', callback_data: 'check_payment:' + invoiceData.uuid }]
                                    ]
                                })
                            };
                            await bot.sendMessage(chatId, `Please follow the payment instructions to complete your purchase.\nInvoice ID: ${invoiceData.uuid}\nYou can pay here: ${invoiceData.link}`, purchaseButton);
                        } else {
                            await bot.sendMessage(chatId, 'Failed to create an invoice. Please try again or contact support.');
                        }
                    } catch (error) {
                        console.error('Error in /buy_keys:', error);
                        await bot.sendMessage(chatId, 'An error occurred. Please try again later.');
                    }
                });
                

                bot.on('callback_query', async (callbackQuery) => {
                    const chatId = callbackQuery.message.chat.id;
                    const userId = callbackQuery.from.id.toString(); // User ID of the Telegram user
                    const data = callbackQuery.data;
                
                    if (data.startsWith('check_payment:')) {
                        const uuid = data.split(':')[1]; // Extract the UUID from the callback data
                
                        // Simulate checking the payment status
                        const paymentStatus = await checkPaymentStatus(uuid); // This needs to be implemented
                
                        if (paymentStatus === 'paid') {
                            // Update user's count in the database
                            db.run('UPDATE users SET count = count + 5 WHERE id = ?', [userId], function(err) {
                                if (err) {
                                    console.error('Database error:', err.message);
                                    bot.sendMessage(chatId, 'Failed to update your account. Please contact support.');
                                } else if (this.changes > 0) {
                                    bot.sendMessage(chatId, 'Your payment has been verified and your account has been updated.');
                                } else {
                                    bot.sendMessage(chatId, 'No account needs updating. Please check if your payment was successful or contact support.');
                                }
                            });
                        } else {
                            bot.sendMessage(chatId, 'Payment not yet confirmed. Please ensure you have completed the payment.');
                        }
                    } else if (data === 'buy_more_keys') {
                        // Handle other data cases like previously
                    }
                });
                
                async function checkPaymentStatus(uuid) {
                    // Here you'd have a call to your backend or payment processor to check the payment status
                    // This is just a placeholder function
                    return 'paid'; // Return 'paid' if payment is successful
                }
                
async function createInvoice(userId, amount) {
    const url = 'https://api.cryptocloud.plus/v2/invoice/create';
    const headers = {
        'Authorization': 'Token eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1dWlkIjoiTWpFd05UUT0iLCJ0eXBlIjoicHJvamVjdCIsInYiOiIxNjlmNmVhMjgxMTk1MjljYWU5YjIwOWIzNDNlNmNiZDc2M2JkZjUwNmU2MzA2ZjViNTQ3MmYxOTliZGIwMTk4IiwiZXhwIjo4ODExNDI4Njc0OX0.UCjp2VyGgrbE0XIRFpxi34USh5MxcmFUr7R8BxVpZ0Y',
        'Content-Type': 'application/json'
    };

    const data = {
        amount: amount,
        shop_id: 'fKviqyULaqy7IDCz',
        currency: 'USD',
        postback_url: 'http://82.180.130.120:3020/successful-payment'  // Your server's postback endpoint
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(data)
        });

        if (response.ok) {
            const responseData = await response.json();
            return {
                uuid: responseData.result.uuid,  // Get the UUID
                link: responseData.result.link  // Get the payment link
            };
        } else {
            console.error('Failed to create invoice:', await response.text());
            return null;
        }
    } catch (error) {
        console.error('Error creating invoice:', error);
        return null;
    }
}

                     // Send the welcome message with the logo
const userFirstName = msg.from.first_name; // Extract the user's first name
const welcomeMessage = `${userFirstName}! Welcome to SAIGA 🇨🇭集`;
// Optionally, include the username if available
const usernamePart = username ? ` (@${username})` : '';
const fullWelcomeMessage = `${welcomeMessage}${usernamePart}`;

// Send the welcome message with the logo
bot.sendPhoto(chatId, logoUrl, {
    caption: fullWelcomeMessage,
    reply_markup: JSON.parse(options.reply_markup) // Ensure your options variable is correctly defined elsewhere
});

         }
     });
    }
    

    // Handle activation key logic
    if (text.startsWith('S-A-I-G-A-')) {
        console.log(`Sending activation code to server: ${text}`);
        db.get("SELECT count FROM users WHERE id = ?", userId, (err, row) => {
            if (err) {
                console.error(err.message);
                bot.sendMessage(chatId, 'An error occurred.');
                return;
            }

            if (row && row.count > 0) {
                // Process the activation key
                axios.post('http://82.180.130.120:3019/activateKey', { activation_code: text })
                    .then(response => {

                        console.log('Server response:', response.data);

                        // Decrease count after successful activation
                        db.run("UPDATE users SET count = count - 1 WHERE id = ?", userId);
                        bot.sendMessage(chatId, 'successfully Activated ✅.');
                    })
                    .catch(error => {
                        console.error(`Error processing activation key: ${error.message}`);
                        bot.sendMessage(chatId, 'Failed to process the activation key.');
                    });
            } else {
                bot.sendMessage(chatId, 'Sorry, you are out of counts. /buy more key');
            }
        });
    }
});

console.log('Bot is running...');
