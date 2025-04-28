# RBX JS SDK

This SDK allows for integrating with the RBX platform through javascript & typescript via node or a browser.
Although yarn is used here, npm can be use instead. Simply replace `yarn build:node` with `npm run build:node` as an example.

### Using

```
yarn add rbx-js-sdk #or npm install rbx-js-sdk --save
```

#### Install Packages

```bash
yarn
```

#### Testing

Create a `test.env` file in the root directory and include the following entries:

```bash
PRIVATE_KEY=""
PUBLIC_KEY=""
FROM_ADDRESS=""
TO_ADDRESS=""
WALLET_ADDRESS=""
EXPLORER_ADDRESS="https://data.rbx.network/api"
```

> Note: keys can be generated without a wallet. To broadcast transactions, you must have a wallet running. It does not need to have any keys/balance associated with it (and shouldn't for security purposes) but needs to be syned to block height in order to validate transactions correctly.

> Additionally: It is recommended you proxy this wallet with a server in the middle. This is for your own security benefits plus will allow you to manage CORS issues. For testing, you will either need to disable cors protection in your browser or have your wallet running on localhost.

Then run:

```bash
yarn test
```

#### build for node

```bash
yarn build:node
```

#### build for browser

```bash
yarn build:browser
```

This will create a file called `lib/browser.js` which can be included in your project.
See `example/browser-example/index.html` for a basic integration example.

> Note: this command will also copy the file to the example folder.

#### Running In Browser

##### Setting up CORS proxy

To combat issues with CORS and to protect your remote wallet's IP address, you'll want to use a proxy.
See the file `src/proxy/server.js`. This is a simple node application that uses `cors-anywhere` to proxy requests.

You'll need to run this by entering the proxy directory and running `yarn start`. You can add a `.env` file to this folder to customize that host/port.

To run this online, you'll need to set this up on a node server. You can use the code contained within or visit [this Github repo](https://github.com/Rob--W/cors-anywhere) for more info.

> Be sure to update the urls for your wallet / explorer including your proxy information in the index.html like so:

```
const txService = new rbx.TransactionService("http://localhost:3001/http://127.0.0.1:7292");
const explorerService = new rbx.ExplorerService("http://localhost:3001/https://data.rbx.network/api");
```

Although this is not required for node, you can still use it by updating your test.env file like so:

```
WALLET_ADDRESS="http://localhost:3001/http://localhost:7292"
EXPLORER_ADDRESS="http://localhost:3001/https://data.rbx.network/api"
```

##### Running

You can simply launch the file `example/browser-example/index.html` in your browser (no web server required!)
Of course, feel free to use http-server or whatever you like.

#### NodeJS Example

See the folder `example/node-example` for a basic overview of how to integrate with this package.

```
cd example/node-example
yarn
yarn build
yarn start
```

Then head to `http://localhost:8080` in your browser.

> This is built in express with typescript but you can just use regular javascript. Express is also not required, it's just an easy way to showcase the functionality.

#### Cipher base fix

You may encounter an error building to the browser due to cipher-base. Open this file:
`node_modules/cipher-base/index.js`

And replace the imports with the following:

````

var Buffer = require('safe-buffer').Buffer
var Transform = require('readable-stream').Transform // replacing instead of "stream"
var StringDecoder = require('string_decoder').StringDecoder
var inherits = require('inherits')

```

> Note: this is automated by the postinstall script when building from source but it may be something you run into.

If you are using this package via npm, you will need to do this manually (only required for browser though).
Add these two lines to your `scripts` section of your package.json:

```
    "postinstall": "yarn fix:cipher",
    "fix:cipher": "cp ./node_modules/rbx-js-sdk/lib/cipher-fix.js ./node_modules/cipher-base/index.js"
```



## 🤝 Contributing

Contributions, issues and feature requests are welcome!<br />Feel free to check [issues page](issues).

## 📝 License

This project is [MIT](LICENSE) licensed.
```
````
