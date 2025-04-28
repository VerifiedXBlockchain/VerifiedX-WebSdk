import figlet from 'figlet';
import { Command } from 'commander';

import inquirer from 'inquirer';

import { KeypairService, ExplorerService, TransactionService } from 'rbx-js'
import { TxOptions, TxType } from 'rbx-js/lib/rbx/transaction';

const program = new Command();

program
    .version("1.0.0")
    .description("An example CLI for managing a directory")
    .option("-l, --ls  [value]", "List directory contents")
    .option("-m, --mkdir <value>", "Create a directory")
    .option("-t, --touch <value>", "Create a file")
    .parse(process.argv);

const options = program.opts();


const explorerService = new ExplorerService('https://data.rbx.network/api');
const keypairService = new KeypairService();
const transactionService = new TransactionService("http://68.183.17.190:7292");


const init = async () => {
    console.log(figlet.textSync("RBX NodeJS CLI"));
}

const menuOptions = [
    "Check Balance",
    "Generate Keypair",
    "Import Private Key",
    "Send Coin",
    "Exit",
]


const mainMenu = () => {

    console.log("==== MENU OPTIONS ====");
    let i = 0;

    for (const opt of menuOptions) {
        i += 1;
        console.log(`${i}: ${opt}`)
    }

    console.log("==========");

    return inquirer.prompt({
        name: "OPTION",
        type: "input",
        message: "What would you like to do?",

    });
}



const promptForBalance = async () => {

    const answers = await inquirer.prompt({
        name: "ADDRESS",
        type: "input",
        message: "RBX Address?",
    })

    const { ADDRESS } = answers;

    const balance = await explorerService.getBalance(ADDRESS);
    console.log(`Balance for ${ADDRESS}:\n${balance}`);

}

const generateKeypair = () => {
    const privateKey = keypairService.generatePrivateKey();
    const publicKey = keypairService.publicFromPrivate(privateKey);
    const address = keypairService.addressFromPrivate(privateKey);

    console.log("Keypair Generated!")
    console.log(`Private Key:\n${privateKey}\n`)
    console.log(`Public Key:\n${publicKey}\n`)
    console.log(`Address:\n${address}\n`)
    console.log("------------------------------")
}

const importPrivateKey = async () => {
    const answers = await inquirer.prompt({
        name: "PRIVATE_KEY",
        type: "input",
        message: "Private Key?",
    })

    const { PRIVATE_KEY } = answers;


    const address = keypairService.addressFromPrivate(PRIVATE_KEY);
    console.log("Address:");
    console.log(address);
}



const sendCoin = async () => {

    const answers = await inquirer.prompt([
        {
            name: "PRIVATE_KEY",
            type: "input",
            message: "Private Key?",
        },
        {
            name: "TO_ADDRESS",
            type: "input",
            message: "To Address?",
        },
        {
            name: "AMOUNT",
            type: "input",
            message: "Amount?",
        },
    ]

    )

    const { PRIVATE_KEY, TO_ADDRESS, AMOUNT } = answers;

    const fromAddress = keypairService.addressFromPrivate(PRIVATE_KEY)

    const options: TxOptions = {
        toAddress: TO_ADDRESS,
        fromAddress: fromAddress,
        amount: Number(AMOUNT),
        type: TxType.transfer,
    }

    const hash = await transactionService.buildAndSendTransaction(options, PRIVATE_KEY, false)
    if (hash) {
        console.log(`TX Sent with hash of ${hash}`)
    } else {
        console.error("A problem occurred");
    }

}


const run = async () => {
    await init();
    loop();
};


const loop = async () => {
    let shouldExit = false;
    const answers = await mainMenu();

    const { OPTION } = answers;

    switch (OPTION) {
        case "1":
            await promptForBalance();
            break;
        case "2":
            generateKeypair();
            break;
        case "3":
            await importPrivateKey();
            break;
        case "4":
            await sendCoin();
            break;
        case "5":
            console.log("Goodbye!")
            shouldExit = true;
            break;
    }

    if (!shouldExit) {
        loop();
    }


}


run();