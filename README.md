# VerifiedX Web SDK

This SDK allows for integrating with the VerifiedX platform through javascript & typescript via node or a browser.
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
PRIVATE_KEY=
FROM_ADDRESS=
TO_ADDRESS=
VFX_API_BASE_URL_TESTNET=https://data-testnet.verifiedx.io/api
VFX_API_BASE_URL_MAINNET=https://data.verifiedx.io/api
```


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


#### Running In Browser

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
