const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const { google } = require('googleapis');

const port = process.env.PORT || 8000;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));

app.get('/', (req, res) => {
    res.sendFile('index.html', {
        root: __dirname
    });
});

const client = new Client({
    restartOnAuthFail: true,
    puppeteer: {
        headless: true,
        args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process', // <- this one doesn't works in Windows
        '--disable-gpu'
        ],
    },
    authStrategy: new LocalAuth()
});

// Settings start here
const maintenaceMode = false;

// Settings end here

// Google Spreadsheet start here
const privatekey = require("./privatekey.json");

const authClient = new google.auth.JWT(
  privatekey.client_email,
  null,
  privatekey.private_key,
  ['https://www.googleapis.com/auth/spreadsheets.readonly']);


// authentication
authClient.authorize()
  .then(function (tokens) {
      console.log("Google API authentication successful.\n");
  })
  .catch(function (error) {
      throw (error);
  });

const secrets = require("./secrets.json");
const sheets = google.sheets('v4');

async function readSpreadsheet(spreadsheetID, sheetName) {
  try {
    var result = await sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheetID,
        range: sheetName,
        auth: authClient
    });
        
    return result.data.values;
  } catch (err) {
    return [];
  }
}
// Google Spreadsheet end here

client.on('message', async msg => {
    if (maintenaceMode) {
        msg.reply("Maaf saat ini sedang dilakukan pemeliharaan sistem. Silakan kembali lagi nanti.");
    } else {
        const today = new Date();
        const contact = await msg.getContact();
        const phNumber = contact.number;

        const bodyMsg = (msg.body).toLowerCase().trim().replace(/\s\s+/g, " ");
        const bodyMsgSplit = bodyMsg.split(" ");

        let greeting = "Selamat datang bapak/ibu.";
        let message = "";

        readSpreadsheet(secrets.spreadsheet_id_informasi, "Pesan").then((response) => {
        if (response.length > 0) { 
            const rows = response; 
            let matchKey = false;
            rows.forEach((element, index) => {
                if (index > 0) {
                    if (element[0] == "greeting") {
                        greeting = element[1];
                    }

                    if (element[0] == bodyMsg) {
                        message = element[1];
                        matchKey = true;
                    }
                }
            });

            if (!matchKey) {
                message = greeting;

                if (bodyMsgSplit.length > 1) {
                    if (bodyMsgSplit[0] == "sampah") { // iuran sampah
                        const sheet = bodyMsgSplit[1];        
                        let  message = `Tidak ada data iuran sampah.`;
                
                        if (sheet == "rekap") {
                            msg.reply(message);
                        } else {
                            const tahun = sheet;
                
                            readSpreadsheet(secrets.spreadsheet_id_sampah, sheet).then((response) => {
                                if (response.length > 0) {
                                    const rows = response;
                                    let  elementH = [];
                                    let  elementD = [];
                                    
                                    rows.forEach((element,index) => {
                                        if (index == 0) {
                                            elementH = element; // ambil header sebagai label  
                                        }
                                
                                        if (index > 0 && element[0] == phNumber) {
                                            elementD = element; // ambil data sebagai value
                                
                                            if (elementD.length > 0) {
                                            if (elementD.length > 3) {
                                                message = "";
                        
                                                elementH.forEach((rowH, idH) => {
                                                elementD.forEach((rowD, idD) => {
                                                    if (idH == idD) {                            
                                                    message = message.concat(rowH).concat(" = ").concat(rowD).concat("\r\n");
                                                    }                
                                                });
                                                });
                                            }
                                            }                           
                                        }          
                                    });
                            
                                    msg.reply(message);
                                } else {                
                                    msg.reply(message);
                                }          
                            });
                        }
                    } else {
                        readSpreadsheet(secrets.spreadsheet_id_informasi, "Pesan").then((response) => {
                            if (response.length > 0) {
                            const rows = response;
                            rows.forEach((element, index) => {            
                                if (index > 0 && element[0] == "greeting") {
                                greeting = element[1];
                                }
                            });
                
                            message = greeting;
                        
                            msg.reply(message);
                            } else {
                            message = greeting;
                        
                            msg.reply(message);
                            }
                        });
                    }
                } else {
                    msg.reply(message);
                }
            } else {
                msg.reply(message);
            }
        } else {
            message = greeting;
        
            msg.reply(message);
        }
        });    
    }
});

client.initialize();

io.on('connection', function(socket) {
    var stayAlive;
    socket.emit('message', 'Connecting...');
  
    client.on('qr', (qr) => {
        console.log('QR RECEIVED', qr);
        qrcode.toDataURL(qr, (err, url) => {
            socket.emit('qr', url);
            socket.emit('message', 'QR Code received, scan please!');
        });
    });
  
    client.on('ready', () => {
        socket.emit('ready', 'Whatsapp is ready!');
        socket.emit('message', 'Whatsapp is ready!');
        stayAlive = setInterval(() => {
            client.pupPage.click("#pane-side");
            socket.emit('message', 'Wake up!');
            console.log('Wake up!');
        }, 60000);
    });
  
    client.on('authenticated', () => {
        socket.emit('authenticated', 'Whatsapp is authenticated!');
        socket.emit('message', 'Whatsapp is authenticated!');
        console.log('AUTHENTICATED');
    });
  
    client.on('auth_failure', function(session) {
        socket.emit('message', 'Auth failure, restarting...');
    });
  
    client.on('disconnected', (reason) => {
        clearInterval(stayAlive);
        console.log('DISCONNECTED: '.concat(reason));
        socket.emit('disconnected', reason);
        socket.emit('message', 'Whatsapp is disconnected!');
        client.destroy();
        client.initialize();
    });
  });

  server.listen(port, function() {
    console.log('App running on *: ' + port);
  });