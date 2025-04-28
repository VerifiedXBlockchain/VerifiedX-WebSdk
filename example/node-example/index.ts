import express, { Express, Request, Response } from 'express'
import path from 'path';
import dotenv from 'dotenv'
import { KeypairService, ExplorerService, TransactionService } from 'rbx-js'
import { apiError } from './utils';
import { TxOptions, TxType } from 'rbx-js/lib/rbx/transaction';



dotenv.config()


const app: Express = express();
const port = process.env.PORT || 8080;

const keypairService = new KeypairService();
const explorerService = new ExplorerService('https://data.rbx.network/api');
const transactionService = new TransactionService(process.env.WALLET_ADDRESS || "http://localhost:7292");



app.get('/', (req: Request, res: Response) => {

    res.sendFile(path.join(__dirname, '/index.html'));

});


app.get('/generate-keypair', (_: Request, res: Response) => {

    const privateKey = keypairService.generatePrivateKey();
    const publicKey = keypairService.publicFromPrivate(privateKey);
    const address = keypairService.addressFromPrivate(privateKey);

    res.status(200).json({
        privateKey: privateKey,
        publicKey: publicKey,
        address: address,
    })

});

app.get('/import/:privateKey', (req, res) => {

    const privateKey = req.params.privateKey;
    const address = keypairService.addressFromPrivate(privateKey);

    res.status(200).json({
        address: address
    })
})


app.get('/latest-block', async (_, res) => {
    const block = await explorerService.latestBlock();
    res.status(200).json(block);
})


app.get('/send-transaction', async (req, res) => {

    const { privateKey, toAddress, fromAddress, amount } = req.query;

    if (!privateKey) {
        return apiError(res, 'query param `privateKey` is required');
    }

    if (!toAddress) {
        return apiError(res, 'query param `toAddress` is required');
    }

    if (!fromAddress) {
        return apiError(res, 'query param `fromAddress` is required');
    }

    if (!amount) {
        return apiError(res, 'query param `amount` is required');
    }

    const options: TxOptions = {
        toAddress: toAddress.toString(),
        fromAddress: fromAddress.toString(),
        amount: Number(amount),
        type: TxType.transfer,
    }

    const hash = await transactionService.buildAndSendTransaction(options, privateKey.toString(), false)

    if (hash) {
        res.status(200).json({ success: true, message: `Transaction broadcasted with hash of ${hash}` });
    } else {
        return apiError(res, 'a problem occurred', 500);
    }

})



app.listen(port, () => {
    console.log(`[server]: Server is running at http://localhost:${port}`);
});

