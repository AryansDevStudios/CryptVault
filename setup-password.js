// setup-password.js
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');
const bcrypt = require('bcryptjs'); // Swapped to bcryptjs

const ENV_PATH = path.join(__dirname, '.env');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log('\x1b[33m%s\x1b[0m', '---------------------------------------------------------');
console.log('\x1b[31m%s\x1b[0m', '⚠️  CRITICAL WARNING ABOUT DATA LOSS:');
console.log('Changing your password/salt will permanently break access to old encrypted files.');
console.log('Ensure you have backed up your data before proceeding.');
console.log('\x1b[33m%s\x1b[0m', '---------------------------------------------------------\n');

// Prompt for password with masked keystrokes
rl.question('Enter your new Master Password: ', (password) => {
    console.log('\n\nProcessing... Please wait...');

    try {
        const saltRounds = 10;
        
        // 1. Generate the bcryptjs hash and the crypto salt
        // (bcryptjs's hash function is synchronous by default or handles promises, 
        // using the standard callback/promise format here)
        bcrypt.hash(password, saltRounds).then((hash) => {
            const salt = crypto.randomBytes(32).toString('hex');

            // 2. Display the values clearly for manual use/websites
            console.log('\x1b[32m%s\x1b[0m', '\n================ GENERATED VALUES ================');
            console.log(`MASTER_PASSWORD_HASH=${hash}`);
            console.log(`KEY_DERIVATION_SALT=${salt}`);
            console.log('\x1b[32m%s\x1b[0m', '==================================================\n');

            // 3. Read and update the .env file
            let envContent = '';
            if (fs.existsSync(ENV_PATH)) {
                envContent = fs.readFileSync(ENV_PATH, 'utf8');
            }

            const lines = envContent.split(/\r?\n/);
            let hasHash = false;
            let hasSalt = false;

            // Map through existing lines to update values if they exist
            const updatedLines = lines.map(line => {
                if (line.trim().startsWith('MASTER_PASSWORD_HASH=')) {
                    hasHash = true;
                    return `MASTER_PASSWORD_HASH=${hash}`;
                }
                if (line.trim().startsWith('KEY_DERIVATION_SALT=')) {
                    hasSalt = true;
                    return `KEY_DERIVATION_SALT=${salt}`;
                }
                return line;
            });

            // If they didn't exist, append them to the end of the file
            if (!hasHash) updatedLines.push(`MASTER_PASSWORD_HASH=${hash}`);
            if (!hasSalt) updatedLines.push(`KEY_DERIVATION_SALT=${salt}`);

            // Write the changes back to the .env file
            fs.writeFileSync(ENV_PATH, updatedLines.join('\n'), 'utf8');
            console.log('\x1b[36m%s\x1b[0m', `✅ Successfully updated your local .env file at: ${ENV_PATH}`);

            rl.close();
            process.exit();
        }).catch(err => {
            console.error('Bcrypt hashing failed:', err);
            rl.close();
            process.exit(1);
        });

    } catch (err) {
        console.error('An error occurred during execution:', err);
        rl.close();
        process.exit(1);
    }
});

// Intercept terminal output to mask password entry with asterisks
rl._writeToOutput = function _writeToOutput(stringToWrite) {
    if (rl.line.length > 0 && stringToWrite !== '\r\n' && stringToWrite !== '\n') {
        rl.output.write('*'); 
    } else {
        rl.output.write(stringToWrite);
    }
};