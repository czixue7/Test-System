package com.exam.test_system

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import android.util.Log
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {

    companion object {
        private const val REQUEST_CODE_INSTALL_PERMISSION = 1001
        private const val REQUEST_CODE_INSTALL_APK = 1002
        private const val TAG = "MainActivity"
    }

    private var pendingApkPath: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        Log.d(TAG, "onCreate: MainActivity 创建")
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
    }

    // 供 Rust 调用的安装方法
    fun installApk(apkPath: String) {
        Log.d(TAG, "installApk: 开始安装 APK, 路径=$apkPath")

        val file = File(apkPath)
        if (!file.exists()) {
            Log.e(TAG, "installApk: APK 文件不存在: $apkPath")
            return
        }

        Log.d(TAG, "installApk: 文件存在, 大小=${file.length()} bytes")

        // Android 8.0+ 需要检查安装权限
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Log.d(TAG, "installApk: Android 8.0+, 检查安装权限")
            if (!packageManager.canRequestPackageInstalls()) {
                Log.d(TAG, "installApk: 没有安装权限, 请求权限")
                pendingApkPath = apkPath
                // 请求安装权限
                val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                    data = Uri.parse("package:$packageName")
                }
                startActivityForResult(intent, REQUEST_CODE_INSTALL_PERMISSION)
                return
            }
            Log.d(TAG, "installApk: 已有安装权限")
        }

        doInstallApk(file)
    }

    private fun doInstallApk(file: File) {
        try {
            Log.d(TAG, "doInstallApk: 启动安装流程")

            val intent = Intent(Intent.ACTION_VIEW).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK

                val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    // Android 7.0+ 使用 FileProvider
                    Log.d(TAG, "doInstallApk: 使用 FileProvider 生成 URI")
                    flags = flags or Intent.FLAG_GRANT_READ_URI_PERMISSION
                    FileProvider.getUriForFile(
                        this@MainActivity,
                        "$packageName.fileprovider",
                        file
                    )
                } else {
                    Log.d(TAG, "doInstallApk: 使用 file:// URI")
                    Uri.fromFile(file)
                }

                Log.d(TAG, "doInstallApk: URI=$uri")
                setDataAndType(uri, "application/vnd.android.package-archive")
            }

            Log.d(TAG, "doInstallApk: 启动安装界面")
            startActivityForResult(intent, REQUEST_CODE_INSTALL_APK)
            Log.d(TAG, "doInstallApk: 安装界面已启动")
        } catch (e: Exception) {
            Log.e(TAG, "doInstallApk: 安装失败: ${e.message}")
            e.printStackTrace()
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)

        Log.d(TAG, "onActivityResult: requestCode=$requestCode, resultCode=$resultCode")

        when (requestCode) {
            REQUEST_CODE_INSTALL_PERMISSION -> {
                Log.d(TAG, "onActivityResult: 权限请求返回")
                // 用户返回后检查权限
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    if (packageManager.canRequestPackageInstalls()) {
                        Log.d(TAG, "onActivityResult: 已获得安装权限")
                        pendingApkPath?.let { path ->
                            doInstallApk(File(path))
                            pendingApkPath = null
                        }
                    } else {
                        Log.w(TAG, "onActivityResult: 未获得安装权限")
                    }
                }
            }
            REQUEST_CODE_INSTALL_APK -> {
                Log.d(TAG, "onActivityResult: 安装完成, resultCode=$resultCode")
            }
        }
    }
}
