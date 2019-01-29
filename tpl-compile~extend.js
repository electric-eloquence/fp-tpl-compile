'use strict';

const path = require('path');

const beautify = require('js-beautify').html;
const fs = require('fs-extra');
const glob = require('glob');
const gulp = require('gulp');
const RcLoader = require('rcloader');
const runSequence = require('run-sequence');
const utils = require('fepper-utils');
const yaml = require('js-yaml');

const appDir = global.appDir;
const conf = global.conf;
const rootDir = global.rootDir;

const dataDir = conf.ui.paths.source.data;
const dataFile = `${dataDir}/_data.json`;
const patternDirPub = conf.ui.paths.public.patterns;
const patternDirSrc = conf.ui.paths.source.patterns;
const tplDir = conf.ui.paths.source.templates;

function tplEncodeHbs(content_) {
  let content = content_;
  content = content.replace(/\{\{/g, '{{{<%');
  content = content.replace(/(\})?\}\}/g, '$1%>}}}');
  content = content.replace(/(\{\{\{<%)/g, '$1}}}');
  content = content.replace(/(%>\}\}\})/g, '{{{$1');

  return content;
}

function writeJsonHbs(jsonFile) {
  fs.writeFileSync(jsonFile, '{\n  "<%": "{{",\n  "%>": "}}"\n}\n');
}

function tplEncode(tplType, argv) {
  if (!argv || !argv.e) {
    utils.error('Error: need an -e argument to identify your source files by extension!');
    return;
  }

  let ext;

  if (argv.e[0] === '.') {
    ext = argv.e;
  }
  else {
    ext = `.${argv.e}`;
  }

  let dataObj = {};
  let dataStr = '';

  try {
    dataObj = fs.readJsonSync(dataFile);
    dataStr = fs.readFileSync(dataFile, conf.enc);
  }
  catch (err) {
    // Fail gracefully. A correctly formed dataFile is not crucial for this.
  }

  const files = glob.sync(`${patternDirSrc}/**/*${ext}`) || [];

  for (let i = 0; i < files.length; i++) {
    let content = fs.readFileSync(files[i], conf.enc);

    // Only Handlebars right now. Could easily encode for other languages.
    switch (tplType) {
      case 'hbs':
        content = tplEncodeHbs(content);
        break;
    }

    const regex = new RegExp(`${ext}$`);

    let mustacheFile = files[i].replace(regex, '.mustache');
    let jsonFile = files[i].replace(regex, '.json');

    fs.writeFileSync(mustacheFile, content);

    // Only Handlebars right now. Could easily encode for other languages.
    switch (tplType) {
      case 'hbs':
        writeJsonHbs(jsonFile);
        break;
    }

    // Crucial part is done. Log to console.
    utils.log(
      '%s encoded to %s.', files[i].replace(rootDir, '').replace(/^\//, ''),
      mustacheFile.replace(rootDir, '').replace(/^\//, '')
    );

    // Clean up.
    fs.unlinkSync(files[i]);

    // Add key/values to _data.json if they are not there.
    // These hide the encoded tags in all views except 03-templates.
    if (!dataObj['<%']) {
      dataStr = dataStr.replace(/\s*\}(\s*)$/, ',\n  "<%": "<!--"\n}$1');
      dataObj = JSON.parse(dataStr);
      fs.writeFileSync(dataFile, dataStr);
    }

    if (!dataObj['%>']) {
      dataStr = dataStr.replace(/\s*\}(\s*)$/, ',\n  "%>": "-->"\n}$1');
      dataObj = JSON.parse(dataStr);
      fs.writeFileSync(dataFile, dataStr);
    }
  }
}

gulp.task('tpl-compile:copy', function (cb) {
  const files = glob.sync(`${tplDir}/**/*.yml`) || [];
  const rcFile = '.jsbeautifyrc';
  const rcLoader = new RcLoader(rcFile);
  let rcOpts;

  // First, try to load .jsbeautifyrc with user-configurable options.
  if (fs.existsSync(`${rootDir}/${rcFile}`)) {
    rcOpts = rcLoader.for(`${rootDir}/${rcFile}`, {lookup: false});
  }
  // Else, load the .jsbeautifyrc that ships with fepper-npm.
  else {
    rcOpts = rcLoader.for(`${appDir}/${rcFile}`, {lookup: false});
  }

  for (let i = 0; i < files.length; i++) {
    let data = {};
    let stats = null;
    let yml = '';

    try {
      stats = fs.statSync(files[i]);
    }
    catch (err) {
      utils.error(err);
      continue;
    }

    // Only process valid files.
    if (!stats || !stats.isFile()) {
      continue;
    }

    try {
      yml = fs.readFileSync(files[i], conf.enc);
      data = yaml.safeLoad(yml);
    }
    catch (err) {
      utils.error(err);
      continue;
    }

    if (!data.tpl_compile_dir || !data.tpl_compile_ext) {
      continue;
    }

    let pubPattern = files[i].replace(`${patternDirSrc}/`, '');
    pubPattern = pubPattern.slice(0, -4);
    pubPattern = pubPattern.replace(/\//g, '-');
    pubPattern = pubPattern.replace(/~/g, '-');
    let pubFile = `${patternDirPub}/${pubPattern}/${pubPattern}.markup-only.html`;
    let pubContent = fs.readFileSync(pubFile, conf.enc);

    // Prep for beautifcation.
    // In order for js-beautify's to indent Handlebars correctly, any space between control characters #, ^, and /, and
    // the variable name must be removed. However, we want to add the spaces back later.
    // \u00A0 is &nbsp; a space character not enterable by keyboard, and therefore a good delimiter.
    pubContent = pubContent.replace(/(\{\{#)(\s+)(\S+)/g, '$1$3$2\u00A0');
    pubContent = pubContent.replace(/(\{\{^)(\s+)(\S+)/g, '$1$3$2\u00A0');
    pubContent = pubContent.replace(/(\{\{\/)(\s+)(\S+)/g, '$1$3$2\u00A0');

    // Load .jsbeautifyrc and beautify html.
    pubContent = beautify(pubContent, rcOpts);

    // Adding back removed spaces to retain the look intended by the authors.
    pubContent = pubContent.replace(/(\{\{#)(\S+)(\s+)\u00A0/g, '$1$3$2');
    pubContent = pubContent.replace(/(\{\{\^)(\S+)(\s+)\u00A0/g, '$1$3$2');
    pubContent = pubContent.replace(/(\{\{\/)(\S+)(\s+)\u00A0/g, '$1$3$2');

    // Prepare extension.
    const tplCompileExt = utils.extNormalize(data.tpl_compile_ext);

    // Build path to destFile.
    let destFile = `${rootDir}/backend/${data.tpl_compile_dir.trim()}/${path.basename(files[i], '.yml')}`;
    destFile += tplCompileExt;

    fs.writeFileSync(destFile, pubContent);

    // Log to console.
    utils.log('Template %s compiled.', destFile.replace(rootDir, '').replace(/^\//, ''));
  }
  cb();
});

gulp.task('tpl-compile', function (cb) {
  runSequence(
    'once',
    'tpl-compile:copy',
    cb
  );
});

gulp.task('tpl-encode:hbs', function (cb) {
  const argv = require('yargs').argv;

  tplEncode('hbs', argv);
  cb();
});
