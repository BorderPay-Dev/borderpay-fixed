package com.borderpayafrica.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.google.firebase.FirebaseApp;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // App Check is instantiated while Capacitor registers native plugins.
        // Initialize the default Firebase app first so plugin construction
        // cannot race Android's automatic FirebaseInitProvider startup.
        FirebaseApp.initializeApp(this);
        super.onCreate(savedInstanceState);
    }
}
