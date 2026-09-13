// Initialize Ace Editor
var editor = ace.edit("editor");
editor.setTheme("ace/theme/monokai");
editor.session.setMode("ace/mode/html");
editor.setValue("// Write your code here\n<!DOCTYPE html>\n<html>\n<head>\n<title>Page</title>\n</head>\n<body>\n  <h1>Hello World</h1>\n</body>\n</html>", -1);

// Save Button Logic (Downloads the file locally)
document.getElementById('save-btn').addEventListener('click', function() {
    var code = editor.getValue();
    var blob = new Blob([code], { type: "text/html;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = "index.html";
    a.click();
    URL.revokeObjectURL(url);
});

// Preview Button Logic
document.getElementById('preview-btn').addEventListener('click', function() {
    var code = editor.getValue();
    var newWindow = window.open();
    newWindow.document.write(code);
    newWindow.document.close();
});

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        navigator.serviceWorker.register('sw.js')
            .then(function(reg) {
                console.log('Service Worker registered:', reg);
            })
            .catch(function(err) {
                console.log('Service Worker registration failed:', err);
            });
    });
}
