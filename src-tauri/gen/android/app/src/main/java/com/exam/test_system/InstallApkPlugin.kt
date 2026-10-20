// Copyright 2026
// SPDX-License-Identifier: MIT

package com.exam.test_system

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@TauriPlugin
class InstallApkPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun install(invoke: Invoke) {
        try {
            val apkPath = invoke.parseArgs(String::class.java)
            val apkFile = File(apkPath)

            if (!apkFile.exists()) {
                invoke.reject("APK 文件不存在: $apkPath")
                return
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val canInstall = activity.packageManager.canRequestPackageInstalls()
                if (!canInstall) {
                    val settingsIntent = Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + activity.packageName)
                    )
                    settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    activity.startActivity(settingsIntent)
                    val result = JSObject().put("status", "REQUEST_INSTALL_PERMISSION")
                    invoke.resolve(result)
                    return
                }
            }

            val authority = activity.packageName + ".fileprovider"
            val apkUri = FileProvider.getUriForFile(activity, authority, apkFile)

            val intent = Intent(Intent.ACTION_VIEW)
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive")
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

            activity.startActivity(intent)
            val result = JSObject().put("status", "INSTALL_INTENT_SENT")
            invoke.resolve(result)
        } catch (ex: Exception) {
            invoke.reject(ex.message)
        }
    }
}
