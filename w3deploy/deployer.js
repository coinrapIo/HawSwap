#!/usr/bin/env node

/*
Usage:
 node deployer.js 
 --config-path ./dev_config.json  # 部署的配置文件，其中tokens必须是已部署的合约地址。
 --gas-price-gwei 3  # gas price(Gwei)
 --rpc-url http://localhost:7545   # 节点访问url
 --priv-key-file ./7f8c   #部署合约的钱包的私钥文件名。
 --print-private-key false  # 是否打印私钥，一般用于临时生成的钱包。
 --signed-tx-output singed_tx.log  #  部署的已签名事务保存到文件中。


 node ./deployer.js --rpc-url https://rinkeby.infura.io/noNACTp9gUjXcRV1QsWo --priv-key-file ./897ee --config-path rinkeby_config.json --signed-tx-output singed_rinkeby_tx.log --gas-price-gwei 5
*/

const Web3 = require("web3");
const fs = require("fs");
const path = require('path');
const RLP = require('rlp');
const BigNumber = require('bignumber.js')

process.on('unhandledRejection', console.error.bind(console))

const { configPath, gasPriceGwei, privKeyFile, printPrivateKey, rpcUrl, signedTxOutput, dontSendTx, chainId: chainIdInput } = require('yargs')
    .usage('Usage: $0 --config-path [path] --gas-price-gwei [gwei] --priv-key-file [priv-key-file] --print-private-key [bool] --rpc-url [url] --signed-tx-output [path] --dont-send-tx [bool] --chain-id')
    .demandOption(['configPath', 'privKeyFile', 'gasPriceGwei', 'rpcUrl'])
    .boolean('printPrivateKey')
    .boolean('dontSendTx')
    .argv;
const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl));
const solc = require('solc')

const rand = web3.utils.randomHex(7);
// const privateKey = web3.utils.sha3("js sucks" + rand);
const privateKey = "0x"+fs.readFileSync(privKeyFile)
if (printPrivateKey) {
  console.log("privateKey", privateKey);
  let path = "privatekey_"  + web3.utils.randomHex(7) + ".txt";
  fs.writeFileSync(path, privateKey, function(err) {
      if(err) {
          return console.log(err);
      }
  });
}
const account = web3.eth.accounts.privateKeyToAccount(privateKey);
// console.log("account.address", account.address)
const sender = account.address;
const gasPrice = BigNumber(gasPriceGwei).mul(10 ** 9);
const signedTxs = [];
let nonce;
let chainId = chainIdInput;

console.log("from",sender);

async function sendTx(txObject) {
  const txTo = txObject._parent.options.address;

  let gasLimit;
  try {
    gasLimit = await txObject.estimateGas();
  }
  catch (e) {
    gasLimit = 500 * 1000;
  }

  if(txTo !== null) {
    gasLimit = 500 * 1000;
  }

  //console.log(gasLimit);
  const txData = txObject.encodeABI();
  const txFrom = account.address;
  const txKey = account.privateKey;

  const tx = {
    from : txFrom,
    to : txTo,
    nonce : nonce,
    data : txData,
    gas : gasLimit,
    chainId,
    gasPrice
  };

  const signedTx = await web3.eth.accounts.signTransaction(tx, txKey);
  nonce++;
  // don't wait for confirmation
  signedTxs.push(signedTx.rawTransaction)
  if (!dontSendTx) {
    // console.log("sender", sender, "txFrom:", txFrom);
    web3.eth.sendSignedTransaction(signedTx.rawTransaction, {from:sender});
  }
}

async function deployContract(solcOutput, contractName, ctorArgs) {

  const actualName = contractName;
  const bytecode = solcOutput.contracts[actualName].bytecode;

  const abi = solcOutput.contracts[actualName].interface;
  const myContract = new web3.eth.Contract(JSON.parse(abi));
  const deploy = myContract.deploy({data:"0x" + bytecode, arguments: ctorArgs});
  let address = "0x" + web3.utils.sha3(RLP.encode([sender,nonce])).slice(12).substring(14);
  address = web3.utils.toChecksumAddress(address);

  await sendTx(deploy);

  myContract.options.address = address;


  return [address,myContract];
}

const contractPath = path.join(__dirname, "../contracts/");

const input = {
  "ConversionAgentInterface.sol" : fs.readFileSync(contractPath + 'ConversionAgentInterface.sol', 'utf8'),
  "ConversionAgent.sol" : fs.readFileSync(contractPath + 'ConversionAgent.sol', 'utf8'),
  "PermissionGroups.sol" : fs.readFileSync(contractPath + 'PermissionGroups.sol', 'utf8'),
  "ERC20Interface.sol" : fs.readFileSync(contractPath + 'ERC20Interface.sol', 'utf8'),
  "SanityRatesInterface.sol" : fs.readFileSync(contractPath + 'SanityRatesInterface.sol', 'utf8'),
  "ExpectedRateInterface.sol" : fs.readFileSync(contractPath + 'ExpectedRateInterface.sol', 'utf8'),
  "SanityRates.sol" : fs.readFileSync(contractPath + 'SanityRates.sol', 'utf8'),
  "ExpectedRate.sol" : fs.readFileSync(contractPath + 'ExpectedRate.sol', 'utf8'),
  "Base.sol" : fs.readFileSync(contractPath + 'Base.sol', 'utf8'),
  "BalanceTracker.sol" : fs.readFileSync(contractPath + 'BalanceTracker.sol', 'utf8'),
  "WhiteListInterface.sol" : fs.readFileSync(contractPath + 'WhiteListInterface.sol', 'utf8'),
  "MartletInstantlyTrader.sol" : fs.readFileSync(contractPath + 'MartletInstantlyTrader.sol', 'utf8'),
  "WhiteList.sol" : fs.readFileSync(contractPath + 'WhiteList.sol', 'utf8'),
  "SupplierInterface.sol" : fs.readFileSync(contractPath + 'SupplierInterface.sol', 'utf8'),
  "Withdrawable.sol" : fs.readFileSync(contractPath + 'Withdrawable.sol', 'utf8'),
  "Supplier.sol" : fs.readFileSync(contractPath + 'Supplier.sol', 'utf8'),
  "Wrapper.sol" : fs.readFileSync(contractPath + 'mockContracts/Wrapper.sol', 'utf8')
};

let coinrapAddress;
let supplierAddress;
let conversionAgentAddress;
let whitelistAddress;
let expectedRateAddress;
let wrapperAddress;

let coinrapContract;
let supplierContract;
let conversionAgentContract;
let whitelistContract;
let expectedRateContract;
let wrapperContract;

let coinrapPermissions;
let supplierPermissions;
let conversionAgentPermissions;
let whitelistPermissions;
let expectedRatePermissions;

const depositAddresses = [];
let maxGasPrice = 50 * 1000 * 1000 * 1000;
let negDiffInBps = 15;
let minExpectedRateSlippage = 200;
let kncWallet;
let kncToEthRate = 307;
let validDurationBlock = 400;
let taxWalletAddress = 0x0;
let taxFeesBps = 1000;

let testers;
let testersCat;
let testersCap;
let users;
let usersCat;
let usersCap;
let kgtAddress;

const ethAddress = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

const tokens = [];
const tokenControlInfo = {};
const tokenNameToAddress = { "ETH" : ethAddress };


function parseInput( jsonInput ) {
    // tokens
    const tokenInfo = jsonInput["tokens"];
    Object.keys(tokenInfo).forEach(function(key) {
      const val = tokenInfo[key];
      const symbol = key;
      const name = val["name"];
      const address = val["address"];

      tokenNameToAddress[symbol] = address;

      tokens.push(address);
      const dict = {
        minimalRecordResolution : web3.utils.toBN(val["minimalRecordResolution"]),
        maxPerBlockImbalance : web3.utils.toBN(val["maxPerBlockImbalance"]),
        maxTotalImbalance : web3.utils.toBN(val["maxTotalImbalance"])
      };
      tokenControlInfo[address] = dict;
    });

    // exchanges
    const exchangeInfo = jsonInput["exchanges"];
    Object.keys(exchangeInfo).forEach(function(exchange) {
      Object.keys(exchangeInfo[exchange]).forEach(function(token){
        const depositAddress = exchangeInfo[exchange][token];
        const dict = {};
        dict[token] = depositAddress;
        depositAddresses.push(dict);
      });
    });

    coinrapPermissions = jsonInput.permission["MartletInstantlyTrader"];
    supplierPermissions = jsonInput.permission["Supplier"];
    conversionAgentPermissions = jsonInput.permission["ConversionAgent"];
    whitelistPermissions = jsonInput.permission["WhiteList"];
    expectedRatePermissions = jsonInput.permission["ExpectedRate"];

    maxGasPrice =  web3.utils.toBN(jsonInput["max gas price"]);
    negDiffInBps = web3.utils.toBN(jsonInput["neg diff in bps"]);
    minExpectedRateSlippage = web3.utils.toBN(jsonInput["min expected rate slippage"]);
    kncWallet = jsonInput["KNC wallet"];
    kncToEthRate = web3.utils.toBN(jsonInput["KNC to ETH rate"]);
    taxFeesBps = jsonInput["tax fees bps"];
    taxWalletAddress = jsonInput["tax wallet address"];
    validDurationBlock = web3.utils.toBN(jsonInput["valid duration block"]);
    testers = jsonInput["whitelist params"]["testers"];
    testersCat = jsonInput["whitelist params"]["testers category"];
    testersCap = jsonInput["whitelist params"]["testers cap"];
    users = jsonInput["whitelist params"]["users"];
    usersCat = jsonInput["whitelist params"]["users category"];
    usersCap = jsonInput["whitelist params"]["users cap"];
    kgtAddress = jsonInput["whitelist params"]["CRP address"];


    // output file name
    outputFileName = jsonInput["output filename"];
};

async function setPermissions(contract, permJson) {
  console.log("set operator(s)");
  for(let i = 0 ; i < permJson.operator.length ; i++ ) {
    const operator = permJson.operator[i];
    console.log(operator);
    await sendTx(contract.methods.addOperator(operator));
  }
  console.log("set alerter(s)");
  for(let i = 0 ; i < permJson.alerter.length ; i++ ) {
    const alerter = permJson.alerter[i];
    console.log(alerter);
    await sendTx(contract.methods.addQuoter(alerter));
  }
  console.log("transferAdminQuickly");
  const admin = permJson.admin;
  console.log(admin);
  await sendTx(contract.methods.transferAdminQuickly(admin));
}


async function main() {
  nonce = await web3.eth.getTransactionCount(sender);
  console.log("nonce",nonce);

  chainId = chainId || await web3.eth.net.getId()
  console.log('chainId', chainId);

  console.log("starting compilation");
  const output = await solc.compile({ sources: input }, 1);
  //console.log(output);
  console.log("finished compilation");

  if (!dontSendTx) {
    await waitForEth();
  }


  console.log("deploying coinrap");
  [coinrapAddress,coinrapContract] = await deployContract(output, "MartletInstantlyTrader.sol:MartletInstantlyTrader", [sender]);
  console.log("deploying conversion rates");
  [conversionAgentAddress,conversionAgentContract] = await deployContract(output, "ConversionAgent.sol:ConversionAgent", [sender]);
  console.log("deploying supplier");
  [supplierAddress,supplierContract] = await deployContract(output, "Supplier.sol:Supplier", [coinrapAddress,conversionAgentAddress,sender]);
  console.log("deploying whitelist");
  [whitelistAddress, whitelistContract] = await deployContract(output, "WhiteList.sol:WhiteList", [sender, kgtAddress]);
  console.log("deploying expected rates");
  [expectedRateAddress, expectedRateContract] = await deployContract(output, "ExpectedRate.sol:ExpectedRate", [coinrapAddress,sender]);
  console.log("deploying wrapper");
  [wrapperAddress, wrapperContract] = await deployContract(output, "Wrapper.sol:Wrapper", [coinrapAddress,sender]);

  console.log("coinrap", coinrapAddress);
  console.log("rates", conversionAgentAddress);
  console.log("supplier", supplierAddress);
  console.log("whitelistAddress", whitelistAddress);
  console.log("expectedRateAddress", expectedRateAddress);
  console.log("wrapperAddress", wrapperAddress);

  // add supplier to coinrap
  console.log("Add supplier to coinrap");
  //console.log(coinrapContract.methods.addReserve(supplierAddress,true));
  await sendTx(coinrapContract.methods.addSupplier(supplierAddress,true));

  console.log("add temp operator to set info data");
  await sendTx(coinrapContract.methods.addOperator(sender));
  let admin = coinrapContract.methods.admin().call((err, result)=>{
    console.log("coinrapContract.adminxxx", result);
  });
  console.log("coinrapContract.admin", admin);
  // list tokens
  for( i = 0 ; i < tokens.length ; i++ ) {
    console.log("listing eth", tokens[i]);
    await sendTx(coinrapContract.methods.listPairForSupplier(supplierAddress,
                                                            ethAddress,
                                                            tokens[i],
                                                            true));
    await sendTx(coinrapContract.methods.listPairForSupplier(supplierAddress,
                                                            tokens[i],
                                                            ethAddress,
                                                            true));

    const srcString1 = web3.utils.sha3("src token " + (2*i).toString());
    const destString1 = web3.utils.sha3("dest token " + (2*i).toString());
    const srcString2 = web3.utils.sha3("src token " + (2*i + 1).toString());
    const destString2 = web3.utils.sha3("dest token " + (2*i + 1).toString());

    await sendTx(coinrapContract.methods.setInfo(srcString1, ethAddress));
    await sendTx(coinrapContract.methods.setInfo(destString1, tokens[i]));
    await sendTx(coinrapContract.methods.setInfo(srcString2, tokens[i]));
    await sendTx(coinrapContract.methods.setInfo(destString2, ethAddress));
  }
  console.log("set num listed pairs info");
  const numListPairsString = web3.utils.sha3("num listed pairs");
  await sendTx(coinrapContract.methods.setInfo(numListPairsString,tokens.length * 2));
  console.log("delete temp operator to set info data");
  await sendTx(coinrapContract.methods.removeOperator(sender));

  // set params
  console.log("coinrap set params");
  await sendTx(coinrapContract.methods.setParams(whitelistAddress,
                                                 expectedRateAddress,
                                                 maxGasPrice,
                                                 negDiffInBps));

  console.log("coinrap enable");
  await sendTx(coinrapContract.methods.setEnable(true));

  // add operator
  await setPermissions(coinrapContract, coinrapPermissions);

  // supplier
  console.log("whitelist deposit addresses");
  for( i = 0 ; i < depositAddresses.length ; i++ ) {
    const dict = depositAddresses[i];
    const tokenSymbol = Object.keys(dict)[0];
    const tokenAddress = tokenNameToAddress[tokenSymbol];
    const depositAddress = dict[tokenSymbol];
    console.log(tokenSymbol,tokenAddress,depositAddress);
    await sendTx(supplierContract.methods.approveWithdrawAddress(tokenAddress,
                                                                depositAddress,
                                                                true));
  }
  await setPermissions(supplierContract, supplierPermissions);

  // expected rates
  console.log("expected rate - add temp operator");
  await sendTx(expectedRateContract.methods.addOperator(sender));
  console.log("expected rate - set slippage to 3%");
  await sendTx(expectedRateContract.methods.setMinSlippageFactor(minExpectedRateSlippage));
  console.log("expected rate - set qty factor to 1");
  await sendTx(expectedRateContract.methods.setQuantityFactor(1));
  console.log("expected rate - remove temp operator");
  await sendTx(expectedRateContract.methods.removeOperator(sender));

  await setPermissions(expectedRateContract, expectedRatePermissions);


  // whitelist
  console.log("white list - add temp opeator to set sgd rate");
  await sendTx(whitelistContract.methods.addOperator(sender));
  console.log("white list - set sgd rate");
  await sendTx(whitelistContract.methods.setSgdToEthRate(web3.utils.toBN("645161290322581")));
  console.log("white list - init users list");
  for(let i = 0 ; i < users.length ; i++ ) {
    console.log(users[i]);
    await sendTx(whitelistContract.methods.setUserCategory(users[i],usersCat));
  }
  console.log("white list - set cat cap");
  await sendTx(whitelistContract.methods.setCategoryCap(usersCat, usersCap));
  console.log("white list - init tester list");
  for(let i = 0 ; i < testers.length ; i++ ) {
    console.log(testers[i]);
    await sendTx(whitelistContract.methods.setUserCategory(testers[i],testersCat));
  }
  console.log("white list - set cat cap");
  await sendTx(whitelistContract.methods.setCategoryCap(testersCat, testersCap));
  console.log("white list - remove temp opeator to set sgd rate");
  await sendTx(whitelistContract.methods.removeOperator(sender));

  await setPermissions(whitelistContract, whitelistPermissions);

  // conversion rates
  console.log("conversion rate - add token");
  for( let i = 0 ; i < tokens.length ; i++ ) {
    console.log(tokens[i]);
    await sendTx(conversionAgentContract.methods.addToken(tokens[i]));
  }

  console.log("conversion rate - set valid duration block");
  await sendTx(conversionAgentContract.methods.setValidRateDurationInBlocks(validDurationBlock));
  console.log("conversion rate - setSupplierAddress");
  await sendTx(conversionAgentContract.methods.setSupplierAddress(supplierAddress));

  console.log("conversion rate - set control info");
  for( let i = 0 ; i < tokens.length ; i++ ) {
    console.log(tokens[i]);
    const dict = tokenControlInfo[tokens[i]];
    await sendTx(conversionAgentContract.methods.setTokenControlInfo(tokens[i],
                                                                     dict.minimalRecordResolution,
                                                                     dict.maxPerBlockImbalance,
                                                                     dict.maxTotalImbalance));
  }

  console.log("conversion rate - enable token trade");
  for( let i = 0 ; i < tokens.length ; i++ ) {
    console.log(tokens[i]);
    const dict = tokenControlInfo[tokens[i]];
    await sendTx(conversionAgentContract.methods.enableTokenTrade(tokens[i]));
  }

  console.log("conversion rate - add temp operator");
  await sendTx(conversionAgentContract.methods.addOperator(sender));
  console.log("conversion rate - set qty step function to 0");
  for( let i = 0 ; i < tokens.length ; i++ ) {
    console.log(tokens[i]);
    await sendTx(conversionAgentContract.methods.setQtyStepFunction(tokens[i],
                                                                    [0],
                                                                    [0],
                                                                    [0],
                                                                    [0]));
  }
  console.log("conversion rate - set imbalance step function to 0");
  for( let i = 0 ; i < tokens.length ; i++ ) {
    console.log(tokens[i]);
    await sendTx(conversionAgentContract.methods.setImbalanceStepFunction(tokens[i],
                                                                    [0],
                                                                    [0],
                                                                    [0],
                                                                    [0]));
  }

  console.log("conversion rate - remove temp operator");
  await sendTx(conversionAgentContract.methods.removeOperator(sender));

  await setPermissions(conversionAgentContract, conversionAgentPermissions);

  console.log("last nonce is", nonce);

  printParams(JSON.parse(content));
  const signedTxsJson = JSON.stringify({ from: sender, txs: signedTxs }, null, 2);
  if (signedTxOutput) {
    fs.writeFileSync(signedTxOutput, signedTxsJson);
  }
}

function printParams(jsonInput) {
    dictOutput = {};
    dictOutput["tokens"] = jsonInput.tokens;
    dictOutput["tokens"]["ETH"] = {"name" : "Ethereum", "decimals" : 18, "address" : ethAddress };
    dictOutput["exchanges"] = jsonInput.exchanges;
    dictOutput["permission"] = jsonInput.permission;
    dictOutput["whitelist params"] = jsonInput["whitelist params"];
    dictOutput["max gas price"] = jsonInput["max gas price"];
    dictOutput["neg diff in bps"] = jsonInput["neg diff in bps"];
    dictOutput["min expected rate slippage"] = jsonInput["min expected rate slippage"];
    dictOutput["KNC wallet"] = kncWallet;
    dictOutput["KNC to ETH rate"] = jsonInput["KNC to ETH rate"];
    dictOutput["tax wallet address"] = jsonInput["tax wallet address"];
    dictOutput["tax fees bps"] = jsonInput["tax fees bps"];
    dictOutput["valid duration block"] = jsonInput["valid duration block"];
    dictOutput["supplier"] = supplierAddress;
    dictOutput["pricing"] = conversionAgentAddress;
    dictOutput["coinrap"] = coinrapAddress;
    dictOutput["wrapper"] = wrapperAddress;
    const json = JSON.stringify(dictOutput, null, 2);
    console.log(json);
    const outputFileName = jsonInput["output filename"];
    console.log(outputFileName, 'write');
    fs.writeFileSync(outputFileName, json);
}


function sleep(ms){
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    })
}

async function waitForEth() {
  while(true) {
    const balance = await web3.eth.getBalance(sender);
    console.log("waiting for balance to account " + sender);
    if(balance.toString() !== "0") {
      console.log("received " + balance.toString() + " wei");
      return;
    }
    else await sleep(10000)
  }
}


let filename;
let content;

try{
  content = fs.readFileSync(configPath, 'utf8');
  //console.log(content.substring(2892,2900));
  //console.log(content.substring(3490,3550));
  parseInput(JSON.parse(content));
}
catch(err) {
  console.log(err);
  process.exit(-1)
}

main();

//console.log(deployContract(output, "cont",5));
