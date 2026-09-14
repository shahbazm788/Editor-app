package com.shahtech.urdeditor;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "SafStorage")
public class SafStoragePlugin extends Plugin {

    private static final String PREFS = "saf_storage_prefs";
    private static final String KEY_TREE_URI = "tree_uri";

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "pickFolderResult");
    }

    @ActivityCallback
    private void pickFolderResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("No folder selected");
            return;
        }
        Uri treeUri = result.getData().getData();
        getContext().getContentResolver().takePersistableUriPermission(
                treeUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        );
        getContext().getSharedPreferences(PREFS, Activity.MODE_PRIVATE)
                .edit().putString(KEY_TREE_URI, treeUri.toString()).apply();

        DocumentFile dir = DocumentFile.fromTreeUri(getContext(), treeUri);
        JSObject ret = new JSObject();
        ret.put("uri", treeUri.toString());
        ret.put("name", dir != null ? dir.getName() : "");
        call.resolve(ret);
    }

    @PluginMethod
    public void getSavedFolder(PluginCall call) {
        String uriStr = getContext().getSharedPreferences(PREFS, Activity.MODE_PRIVATE).getString(KEY_TREE_URI, null);
        JSObject ret = new JSObject();
        if (uriStr == null) {
            ret.put("uri", JSObject.NULL);
        } else {
            DocumentFile dir = DocumentFile.fromTreeUri(getContext(), Uri.parse(uriStr));
            ret.put("uri", uriStr);
            ret.put("name", dir != null ? dir.getName() : "");
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void listFiles(PluginCall call) {
        DocumentFile root = getRoot();
        if (root == null) { call.reject("No folder selected"); return; }
        JSArray arr = new JSArray();
        walk(root, "", arr);
        JSObject ret = new JSObject();
        ret.put("files", arr);
        call.resolve(ret);
    }

    private void walk(DocumentFile dir, String prefix, JSArray arr) {
        if (dir == null) return;
        for (DocumentFile f : dir.listFiles()) {
            String path = prefix.isEmpty() ? f.getName() : prefix + "/" + f.getName();
            if (f.isDirectory()) walk(f, path, arr);
            else arr.put(path);
        }
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        String path = call.getString("path");
        DocumentFile root = getRoot();
        if (path == null || root == null) { call.reject("Missing path or folder"); return; }
        DocumentFile target = findByPath(root, path);
        if (target == null) { call.reject("File not found"); return; }
        try {
            InputStream is = getContext().getContentResolver().openInputStream(target.getUri());
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] data = new byte[4096];
            int n;
            while ((n = is.read(data)) != -1) buffer.write(data, 0, n);
            is.close();
            JSObject ret = new JSObject();
            ret.put("data", new String(buffer.toByteArray(), StandardCharsets.UTF_8));
            call.resolve(ret);
        } catch (IOException e) {
            call.reject("Read failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        String path = call.getString("path");
        String data = call.getString("data", "");
        DocumentFile root = getRoot();
        if (path == null || root == null) { call.reject("Missing path or folder"); return; }
        try {
            DocumentFile target = findOrCreateByPath(root, path);
            OutputStream os = getContext().getContentResolver().openOutputStream(target.getUri(), "wt");
            os.write(data.getBytes(StandardCharsets.UTF_8));
            os.close();
            call.resolve();
        } catch (IOException e) {
            call.reject("Write failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        String path = call.getString("path");
        DocumentFile root = getRoot();
        if (path == null || root == null) { call.reject("Missing path or folder"); return; }
        DocumentFile target = findByPath(root, path);
        if (target != null && target.delete()) call.resolve();
        else call.reject("Delete failed");
    }

    private DocumentFile getRoot() {
        String uriStr = getContext().getSharedPreferences(PREFS, Activity.MODE_PRIVATE).getString(KEY_TREE_URI, null);
        if (uriStr == null) return null;
        return DocumentFile.fromTreeUri(getContext(), Uri.parse(uriStr));
    }

    private DocumentFile findByPath(DocumentFile root, String path) {
        DocumentFile current = root;
        for (String part : path.split("/")) {
            if (current == null) return null;
            current = current.findFile(part);
        }
        return current;
    }

    private DocumentFile findOrCreateByPath(DocumentFile root, String path) {
        String[] parts = path.split("/");
        DocumentFile current = root;
        for (int i = 0; i < parts.length - 1; i++) {
            DocumentFile next = current.findFile(parts[i]);
            if (next == null) next = current.createDirectory(parts[i]);
            current = next;
        }
        String fileName = parts[parts.length - 1];
        DocumentFile file = current.findFile(fileName);
        if (file == null) file = current.createFile(guessMime(fileName), fileName);
        return file;
    }

    private String guessMime(String fileName) {
        if (fileName.endsWith(".html")) return "text/html";
        if (fileName.endsWith(".css")) return "text/css";
        if (fileName.endsWith(".js")) return "text/javascript";
        if (fileName.endsWith(".json")) return "application/json";
        return "text/plain";
    }
}