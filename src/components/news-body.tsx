"use client"

/**
 * Renders sanitised news article HTML, replacing each `<video>` element
 * with the project's `<VideoPlayer>` so embedded media gets a
 * custom control bar instead of browser-native controls.
 */

import * as React from "react"
import { VideoPlayer } from "@/components/video-player"

type VideoSegment = {
  kind: "video"
  src: string
  poster: string | undefined
  key: string
}

type HtmlSegment = {
  kind: "html"
  html: string
  key: string
}

type Segment = VideoSegment | HtmlSegment

function parseHtmlToSegments(html: string): Segment[] {
  const segments: Segment[] = []
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, "text/html")
  const body = doc.body

  let keyIndex = 0
  const processNode = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element
      if (element.tagName === "VIDEO") {
        const src = element.getAttribute("src") || ""
        const poster = element.getAttribute("poster") || undefined
        segments.push({
          kind: "video",
          src,
          poster,
          key: `video-${keyIndex++}`,
        })
      } else {
        const wrapper = document.createElement("div")
        wrapper.appendChild(element.cloneNode(true))
        segments.push({
          kind: "html",
          html: wrapper.innerHTML,
          key: `html-${keyIndex++}`,
        })
      }
    } else if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim()
      if (text) {
        segments.push({
          kind: "html",
          html: text,
          key: `html-${keyIndex++}`,
        })
      }
    }
  }

  body.childNodes.forEach(processNode)
  return segments
}

export type NewsBodyProps = {
  html: string
  className?: string
}

export function NewsBody({ html, className }: NewsBodyProps) {
  const segments = React.useMemo(() => {
    return parseHtmlToSegments(html)
  }, [html])

  return (
    <div className={className}>
      {segments.map((segment) =>
        segment.kind === "video" ? (
          <div key={segment.key} className="my-6">
            <VideoPlayer
              src={segment.src}
              poster={segment.poster}
              className="aspect-video w-full rounded-lg"
            >
              Your browser does not support the video tag.
            </VideoPlayer>
          </div>
        ) : (
          <div
            key={segment.key}
            dangerouslySetInnerHTML={{ __html: segment.html }}
          />
        )
      )}
    </div>
  )
}
