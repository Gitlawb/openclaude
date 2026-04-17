import { c as _c } from "react-compiler-runtime";
import { toString as qrToString } from 'qrcode';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { Pane } from '../../components/design-system/Pane.js';
import { Box, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { useAppState } from '../../state/AppState.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { logForDebugging } from '../../utils/debug.js';
type Props = {
  onDone: () => void;
};
function SessionInfo(t0) {
  const $ = _c(19);
  const {
    onDone
  } = t0;
  const remoteSessionUrl = useAppState(_temp);
  const [qrCode, setQrCode] = useState("");
  let t1;
  let t2;
  if ($[0] !== remoteSessionUrl) {
    t1 = () => {
      if (!remoteSessionUrl) {
        return;
      }
      const url = remoteSessionUrl;
      const generateQRCode = async function generateQRCode() {
        const qr = await qrToString(url, {
          type: "utf8",
          errorCorrectionLevel: "L"
        });
        setQrCode(qr);
      };
      generateQRCode().catch(_temp2);
    };
    t2 = [remoteSessionUrl];
    $[0] = remoteSessionUrl;
    $[1] = t1;
    $[2] = t2;
  } else {
    t1 = $[1];
    t2 = $[2];
  }
  useEffect(t1, t2);
  let t3;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = {
      context: "Confirmation"
    };
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  useKeybinding("confirm:no", onDone, t3);
  if (!remoteSessionUrl) {
    let t4;
    if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
      t4 = <Pane><Text color="warning">Not in remote mode. Start with `nnc --remote` to use this command.</Text><Text dimColor={true}>(press esc to close)</Text></Pane>;
      $[4] = t4;
    } else {
      t4 = $[4];
    }
    return t4;
  }
  let T0;
  let t4;
  let t5;
  if ($[5] !== qrCode) {
    const lines = qrCode.split("\n").filter(_temp3);
    const isLoading = lines.length === 0;
    T0 = Pane;
    if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
      t4 = <Box marginBottom={1}><Text bold={true}>Remote session</Text></Box>;
      $[9] = t4;
    } else {
      t4 = $[9];
    }
    t5 = isLoading ? <Text dimColor={true}>Generating QR code…</Text> : lines.map(_temp4);
    $[5] = qrCode;
    $[6] = T0;
    $[7] = t4;
    $[8] = t5;
  } else {
    T0 = $[6];
    t4 = $[7];
    t5 = $[8];
  }
  let t6;
  if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Text dimColor={true}>Open in browser: </Text>;
    $[10] = t6;
  } else {
    t6 = $[10];
  }
  let t7;
  if ($[11] !== remoteSessionUrl) {
    t7 = <Box marginTop={1}>{t6}<Text color="ide">{remoteSessionUrl}</Text></Box>;
    $[11] = remoteSessionUrl;
    $[12] = t7;
  } else {
    t7 = $[12];
  }
  let t8;
  if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <Box marginTop={1}><Text dimColor={true}>(press esc to close)</Text></Box>;
    $[13] = t8;
  } else {
    t8 = $[13];
  }
  let t9;
  if ($[14] !== T0 || $[15] !== t4 || $[16] !== t5 || $[17] !== t7) {
    t9 = <T0>{t4}{t5}{t7}{t8}</T0>;
    $[14] = T0;
    $[15] = t4;
    $[16] = t5;
    $[17] = t7;
    $[18] = t9;
  } else {
    t9 = $[18];
  }
  return t9;
}
function _temp4(line_0, i) {
  return <Text key={i}>{line_0}</Text>;
}
function _temp3(line) {
  return line.length > 0;
}
function _temp2(e) {
  logForDebugging("QR code generation failed", e);
}
function _temp(s) {
  return s.remoteSessionUrl;
}
export const call: LocalJSXCommandCall = async onDone => {
  return <SessionInfo onDone={onDone} />;
};
