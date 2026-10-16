import { ImageResponse } from "next/og";
import { APP_NAME } from "@/lib/utils";

export const alt = APP_NAME;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#18181b",
          color: "#fafafa",
          fontSize: 88,
          fontWeight: 700,
        }}
      >
        {APP_NAME}
      </div>
    ),
    size,
  );
}
