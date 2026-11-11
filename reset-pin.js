const { DatabaseSync } = require('node:sqlite');
new DatabaseSync('aquamega.db').exec("DELETE FROM settings WHERE k='pin'");
console.log('Passcode cleared.');