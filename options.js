

function debugCheckboxChange(event) {
  const checkbox = event.target;
  const conf = { debug: checkbox.checked };
  browser.storage.local.set(conf);
}

function loadConf() {
  const storageItem = browser.storage.local.get();
  
  storageItem.then((conf) => {
    console.debug('FLT> loadConf', conf);
    
    document.getElementById('debugCheckbox').checked = (conf.debug === true);
    
  }).catch( error => {
    console.error( 'FLT> loadConf error: ', error);
  })
  
}


document.addEventListener('DOMContentLoaded', loadConf);

document.getElementById('debugCheckbox').addEventListener('change', debugCheckboxChange);

