#!/usr/bin/env node

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const puppeteer = require('puppeteer');
const { SteamCmd } = require('steamcmd-interface');
const spinner = require('ora')();
const { SingleBar, Presets } = require('cli-progress');
const { lookpath } = require('lookpath');
const inquirer = require('inquirer');
inquirer.registerPrompt('autocomplete', require('inquirer-autocomplete-prompt'));

async function getSteamServers() {
  const browser = await puppeteer.launch();
  const userAgent = (await browser.userAgent()).replace(/Headless/g, '');
  const page = await browser.newPage();
  await page.setUserAgent(userAgent);
  await page.goto('https://steamdb.info/search/?a=app&q=Server', { waitUntil: 'domcontentloaded' });

  await page.select('select[name="table-sortable_length"]', "-1");

  const apps = await page.evaluate(() => {
    const $apps = Array.from(document.querySelectorAll('tr.app'));
    const apps = {};

    for (const $app of $apps) {
      apps[$app.querySelector('td:nth-child(3)').textContent] = $app.querySelector('td:nth-child(1)').textContent;
    }

    return apps;
  });

  browser.close();
  return apps;
}

(async () => {
  spinner.start('Preparing SteamCMD');
  const STEAM_SERVER_LIB = path.resolve(await lookpath('steamserver'), '../../lib/steamserver');
  if (!fs.existsSync(STEAM_SERVER_LIB)) await fsp.mkdir(STEAM_SERVER_LIB, { recursive: true });

  const steamcmd = await SteamCmd.init({
    binDir: STEAM_SERVER_LIB,
    installDir: STEAM_SERVER_LIB
  });
  spinner.stop();

  spinner.start('Fetching usable game servers');
  const apps = await getSteamServers();
  spinner.stop();

  const { app } = await inquirer.prompt([{
    type: 'autocomplete',
    name: 'app',
    message: 'Enter the Game Name:',
    source: function(answersSoFar, input) {
      if (!input) return Object.keys(apps);
      return Object.keys(apps).filter(app => app.startsWith(input));
    }
  }]);

  const bar = new SingleBar({}, Presets.shades_classic);
  let firstIteration = true;

  try {
    spinner.start('Checking to see if OS is compatible');
    for await (const progress of steamcmd.updateApp(apps[app])) {
      if (progress.progressTotalAmount && firstIteration) {
        spinner.stop();
        console.log(`Downloading "${app}" with game id ${apps[app]}`);
        bar.start(progress.progressTotalAmount, progress.progressAmount);
        firstIteration = false;
      } else {
        bar.update(progress.progressAmount);
      }
    }
    bar.stop();
    spinner.stop();
    console.log('Download complete!');
  } catch (error) {
    spinner.stop();
    if (error.exitCode === 8) {
      switch (require('os').platform()) {
        case 'darwin':
          console.log(`${app} is not compatible with MacOS`);
          break;
        case 'win32':
          console.log(`${app} is not compatible with Windows`);
          break;
        default:
          console.log(`${app} is not compatible with Linux`);
          break;
      }
      
    } else {
      console.log(error);
    }
  }
})();