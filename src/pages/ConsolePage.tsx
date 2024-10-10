/**
 * Running a local relay server will allow you to hide your API key
 * and run custom logic on the server
 *
 * Set the local relay server address to:
 * REACT_APP_LOCAL_RELAY_SERVER_URL=http://localhost:8081
 *
 * This will also require you to set OPENAI_API_KEY= in a `.env` file
 * You can run it with `npm run relay`, in parallel with `npm start`
 */
const LOCAL_RELAY_SERVER_URL: string =
  process.env.REACT_APP_LOCAL_RELAY_SERVER_URL || '';

import { useCallback, useEffect, useRef, useState } from 'react';

import { RealtimeClient } from '@openai/realtime-api-beta';
// eslint-disable-next-line import/no-unresolved
import { ItemType } from '@openai/realtime-api-beta/dist/lib/client.js';
import { WavRecorder, WavStreamPlayer } from '../lib/wavtools/index.js';
import {
  instructions,
  showAudioControls,
  startingPrompt,
  temperature,
  voice,
} from '../utils/conversation_config';
import { WavRenderer } from '../utils/wav_renderer';

import { ArrowDown, ArrowUp, Edit, X, Zap } from 'react-feather';
import { Button } from '../components/button/Button';
import { Map } from '../components/Map';
import { Toggle } from '../components/toggle/Toggle';

import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

import { useDispatch, useSelector } from 'react-redux';
import { removeMemory, selectMemory, updateMemory } from '../store/memorySlice';
import './ConsolePage.scss';

import { default as OpenAI } from 'openai';
import Markdown from 'react-markdown';
import { currentTimeFormatted } from '../utils/current-time-formatted';
import { _onTool } from '../utils/on-tool';

/**
 * Type for result from get_weather() function call
 */
interface Coordinates {
  lat: number;
  lng: number;
  location?: string;
  temperature?: {
    value: number;
    units: string;
  };
  wind_speed?: {
    value: number;
    units: string;
  };
}

/**
 * Type for all event logs
 */
interface RealtimeEvent {
  time: string;
  source: 'client' | 'server';
  count?: number;
  event: { [key: string]: any };
}

export function ConsolePage() {
  /**
   * Ask user for API Key
   * If we're using the local relay server, we don't need this
   */
  const apiKey = LOCAL_RELAY_SERVER_URL
    ? ''
    : localStorage.getItem('tmp::voice_api_key') ||
      prompt('OpenAI API Key') ||
      '';
  if (apiKey !== '') {
    localStorage.setItem('tmp::voice_api_key', apiKey);
  }

  /**
   * Instantiate:
   * - WavRecorder (speech input)
   * - WavStreamPlayer (speech output)
   * - RealtimeClient (API client)
   */
  const wavRecorderRef = useRef<WavRecorder>(
    new WavRecorder({ sampleRate: 24000 }),
  );
  const wavStreamPlayerRef = useRef<WavStreamPlayer>(
    new WavStreamPlayer({ sampleRate: 24000 }),
  );
  const openAIRef = useRef<OpenAI>(
    new OpenAI({
      apiKey: process.env.REACT_APP_OPENAI_API_KEY, // ! TODO CRITICAL ! - Don't use in production
      dangerouslyAllowBrowser: true,
    }),
  );

  const clientRef = useRef<RealtimeClient | null>(null);

  useEffect(() => {
    if (!clientRef.current) {
      clientRef.current = new RealtimeClient(
        LOCAL_RELAY_SERVER_URL
          ? { url: LOCAL_RELAY_SERVER_URL } // debug: true
          : {
              apiKey: apiKey,
              dangerouslyAllowAPIKeyInBrowser: true,
            },
      );
    }
  }, [apiKey]);

  useEffect(() => {
    console.log('~~~ Loaded', clientRef.current);
  }, []);

  /**
   * References for
   * - Rendering audio visualization (canvas)
   * - Autoscrolling event logs
   * - Timing delta for event log displays
   */
  const clientCanvasRef = useRef<HTMLCanvasElement>(null);
  const serverCanvasRef = useRef<HTMLCanvasElement>(null);
  const eventsScrollHeightRef = useRef(0);
  const eventsScrollRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<string>(new Date().toISOString());

  /**
   * All of our variables for displaying application state
   * - items are all conversation items (dialog)
   * - realtimeEvents are event logs, which can be expanded
   * - memory is for set_memory() function
   * - coords, marker are for get_weather() function
   */
  const [items, setItems] = useState<ItemType[]>([]);
  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEvent[]>([]);
  const [expandedEvents, setExpandedEvents] = useState<{
    [key: string]: boolean;
  }>({});
  const [isConnected, setIsConnected] = useState(false);
  const [canPushToTalk, setCanPushToTalk] = useState(true);
  const [isRecording, setIsRecording] = useState(false);

  const dispatch = useDispatch();
  const memory = useSelector(selectMemory);

  const [coords, setCoords] = useState<Coordinates | null>({
    lat: 37.775593,
    lng: -122.418137,
  });
  const [marker, setMarker] = useState<Coordinates | null>(null);
  const [visibleBlocks, setVisibleBlocks] = useState<{
    [key: string]: boolean;
  }>({
    events: true,
    conversation: true,
  });

  const [information, setInformation] = useState<string | null>(null);

  const [displayedImage, setDisplayedImage] = useState<string | null>(null);

  /**
   * Utility for formatting the timing of logs
   */
  const formatTime = useCallback((timestamp: string) => {
    const startTime = startTimeRef.current;
    const t0 = new Date(startTime).valueOf();
    const t1 = new Date(timestamp).valueOf();
    const delta = t1 - t0;
    const hs = Math.floor(delta / 10) % 100;
    const s = Math.floor(delta / 1000) % 60;
    const m = Math.floor(delta / 60_000) % 60;
    const pad = (n: number) => {
      let s = n + '';
      while (s.length < 2) {
        s = '0' + s;
      }
      return s;
    };
    return `${pad(m)}:${pad(s)}.${pad(hs)}`;
  }, []);

  /**
   * When you click the API key
   */
  const resetAPIKey = useCallback(() => {
    const apiKey = prompt('OpenAI API Key');
    if (apiKey !== null) {
      localStorage.clear();
      localStorage.setItem('tmp::voice_api_key', apiKey);
      window.location.reload();
    }
  }, []);

  /**
   * Toggle visibility of content-block-body
   */
  const toggleVisibility = useCallback((block: string) => {
    setVisibleBlocks((prev) => ({
      ...prev,
      [block]: !prev[block],
    }));
  }, []);

  /**
   * Connect to conversation:
   * WavRecorder takes speech input, WavStreamPlayer output, client is API client
   */
  const connectConversation = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;

    const wavRecorder = wavRecorderRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;

    // Set state variables
    startTimeRef.current = new Date().toISOString();
    setIsConnected(true);
    setRealtimeEvents([]);
    setItems(client.conversation.getItems());

    // Connect to microphone
    await wavRecorder.begin();

    // Connect to audio output
    await wavStreamPlayer.connect();

    // Connect to realtime API
    await client.connect();
    client.sendUserMessageContent([
      {
        type: `input_text`,
        text: startingPrompt,
      },
    ]);

    if (client.getTurnDetectionType() === 'server_vad') {
      await wavRecorder.record((data) => {
        if (client.isConnected()) {
          client.appendInputAudio(data.mono);
        } else {
          console.warn('Client is not connected');
        }
      });
    }
  }, []);

  /**
   * Disconnect and reset conversation state
   */
  const disconnectConversation = useCallback(async () => {
    console.log('Disconnecting...');
    setIsConnected(false);
    setRealtimeEvents([]);
    setItems([]);
    // dispatch(setMemory({}));
    setCoords({
      lat: 37.775593,
      lng: -122.418137,
    });
    setMarker(null);

    const client = clientRef.current;
    if (!client) return;

    client.disconnect();

    const wavRecorder = wavRecorderRef.current;
    await wavRecorder.end();

    const wavStreamPlayer = wavStreamPlayerRef.current;
    await wavStreamPlayer.interrupt();
  }, []);

  const deleteConversationItem = useCallback((id: string) => {
    const client = clientRef.current;
    if (!client) return;

    client.deleteItem(id);
  }, []);

  /**
   * In push-to-talk mode, start recording
   * .appendInputAudio() for each sample
   */
  const startRecording = async () => {
    setIsRecording(true);
    const client = clientRef.current;
    if (!client) return;

    const wavRecorder = wavRecorderRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;
    const trackSampleOffset = wavStreamPlayer.interrupt();
    if (trackSampleOffset?.trackId) {
      const { trackId, offset } = trackSampleOffset;
      client.cancelResponse(trackId, offset);
    }
    await wavRecorder.record((data) => {
      if (client.isConnected()) {
        client.appendInputAudio(data.mono);
      } else {
        console.warn('Client is not connected');
      }
    });
  };

  /**
   * In push-to-talk mode, stop recording
   */
  const stopRecording = async () => {
    setIsRecording(false);
    const client = clientRef.current;
    if (!client) return;

    const wavRecorder = wavRecorderRef.current;
    await wavRecorder.pause();
    if (client.isConnected()) {
      client.createResponse();
    } else {
      console.warn('Client is not connected');
    }
  };

  /**
   * Switch between Manual <> VAD mode for communication
   */
  const changeTurnEndType = async (value: string) => {
    const client = clientRef.current;
    if (!client) return;

    const wavRecorder = wavRecorderRef.current;
    if (value === 'none' && wavRecorder.getStatus() === 'recording') {
      await wavRecorder.pause();
    }
    client.updateSession({
      turn_detection: value === 'none' ? null : { type: 'server_vad' },
    });
    if (value === 'server_vad' && client.isConnected()) {
      await wavRecorder.record((data) => {
        if (client.isConnected()) {
          client.appendInputAudio(data.mono);
        } else {
          console.warn('Client is not connected');
        }
      });
    }
    setCanPushToTalk(value === 'none');
  };

  /**
   * Auto-scroll the event logs
   */
  useEffect(() => {
    if (eventsScrollRef.current) {
      const eventsEl = eventsScrollRef.current;
      const scrollHeight = eventsEl.scrollHeight;
      // Only scroll if height has just changed
      if (scrollHeight !== eventsScrollHeightRef.current) {
        eventsEl.scrollTop = scrollHeight;
        eventsScrollHeightRef.current = scrollHeight;
      }
    }
  }, [realtimeEvents]);

  /**
   * Auto-scroll the conversation logs
   */
  useEffect(() => {
    const conversationEls = [].slice.call(
      document.body.querySelectorAll('[data-conversation-content]'),
    );
    for (const el of conversationEls) {
      const conversationEl = el as HTMLDivElement;
      conversationEl.scrollTop = conversationEl.scrollHeight;
    }
  }, [items]);

  /**
   * Set up render loops for the visualization canvas
   */
  useEffect(() => {
    let isLoaded = true;

    const wavRecorder = wavRecorderRef.current;
    const clientCanvas = clientCanvasRef.current;
    let clientCtx: CanvasRenderingContext2D | null = null;

    const wavStreamPlayer = wavStreamPlayerRef.current;
    const serverCanvas = serverCanvasRef.current;
    let serverCtx: CanvasRenderingContext2D | null = null;

    const render = () => {
      if (isLoaded) {
        if (clientCanvas) {
          if (!clientCanvas.width || !clientCanvas.height) {
            clientCanvas.width = clientCanvas.offsetWidth;
            clientCanvas.height = clientCanvas.offsetHeight;
          }
          clientCtx = clientCtx || clientCanvas.getContext('2d');
          if (clientCtx) {
            clientCtx.clearRect(0, 0, clientCanvas.width, clientCanvas.height);
            const result = wavRecorder.recording
              ? wavRecorder.getFrequencies('voice')
              : { values: new Float32Array([0]) };
            WavRenderer.drawBars(
              clientCanvas,
              clientCtx,
              result.values,
              '#0099ff',
              10,
              0,
              8,
            );
          }
        }
        if (serverCanvas) {
          if (!serverCanvas.width || !serverCanvas.height) {
            serverCanvas.width = serverCanvas.offsetWidth;
            serverCanvas.height = serverCanvas.offsetHeight;
          }
          serverCtx = serverCtx || serverCanvas.getContext('2d');
          if (serverCtx) {
            serverCtx.clearRect(0, 0, serverCanvas.width, serverCanvas.height);
            const result = wavStreamPlayer.analyser
              ? wavStreamPlayer.getFrequencies('voice')
              : { values: new Float32Array([0]) };
            WavRenderer.drawBars(
              serverCanvas,
              serverCtx,
              result.values,
              '#009900',
              10,
              0,
              8,
            );
          }
        }
        window.requestAnimationFrame(render);
      }
    };
    render();

    return () => {
      isLoaded = false;
    };
  }, []);

  /**
   * Core RealtimeClient and audio capture setup
   * Set all of our instructions, tools, events and more
   */
  useEffect(() => {
    // Get refs
    const wavStreamPlayer = wavStreamPlayerRef.current;
    const client = clientRef.current;
    if (!client) return;

    // Set instructions
    client.updateSession({
      instructions: `${instructions}\n\nCurrent Memory:\n${JSON.stringify(
        memory,
        null,
        2,
      )}`,
    });
    // Set transcription, otherwise we don't get user transcriptions back
    client.updateSession({ input_audio_transcription: { model: 'whisper-1' } });
    // Set voice, temperature
    client.updateSession({ voice, temperature });

    // Add tools
    client.addTool(
      {
        name: 'set_memory',
        description: 'Saves important data about the user into memory.',
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description:
                'The key of the memory value. Always use lowercase and underscores, no other characters.',
            },
            value: {
              type: 'string',
              description: 'Value can be anything represented as a string',
            },
          },
          required: ['key', 'value'],
        },
      },
      (args: unknown) =>
        _onTool(args, ({ key, value }: { [key: string]: any }) => {
          dispatch(updateMemory({ key, value }));
          return { ok: true };
        }),
    );
    client.addTool(
      {
        name: 'remove_memory',
        description: 'Removes data from the memory.',
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description:
                'The key of the memory value to be removed. Always use lowercase and underscores, no other characters.',
            },
          },
          required: ['key'],
        },
      },
      (args: unknown) =>
        _onTool(args, ({ key }: { key: string }) => {
          dispatch(removeMemory(key));
          return { ok: true };
        }),
    );
    client.addTool(
      {
        name: 'get_time',
        description: "Retrieves the current time in the user's timezone.",
        parameters: {},
      },
      (args: unknown) =>
        _onTool(args, () => ({
          ok: true,
          value: currentTimeFormatted(),
        })),
    );
    client.addTool(
      {
        name: 'show_location',
        description:
          'Shows a location on a map with a given lat, lng coordinate pair. Specify a label for the location.',
        parameters: {
          type: 'object',
          properties: {
            lat: {
              type: 'number',
              description: 'Latitude',
            },
            lng: {
              type: 'number',
              description: 'Longitude',
            },
            location: {
              type: 'string',
              description: 'Name of the location',
            },
          },
          required: ['lat', 'lng', 'location'],
        },
      },
      (args: unknown) =>
        _onTool(args, ({ lat, lng, location }: { [key: string]: any }) => {
          setMarker({ lat, lng, location });
          setCoords({ lat, lng, location });
          return { ok: true };
        }),
    );
    client.addTool(
      {
        name: 'show_info',
        description: 'Shows formatted information to the user.',
        parameters: {
          type: 'object',
          properties: {
            information: {
              type: 'string',
              description:
                'Formatted information to display. Format: markdown.',
            },
          },
          required: ['information'],
        },
      },
      (args: unknown) =>
        _onTool(args, async ({ information }: { information: string }) => {
          setInformation(information);
          return { ok: true };
        }),
    );
    client.addTool(
      {
        name: 'get_weather',
        description:
          'Retrieves the weather for a given lat, lng coordinate pair. Specify a label for the location.',
        parameters: {
          type: 'object',
          properties: {
            lat: {
              type: 'number',
              description: 'Latitude',
            },
            lng: {
              type: 'number',
              description: 'Longitude',
            },
            location: {
              type: 'string',
              description: 'Name of the location',
            },
          },
          required: ['lat', 'lng', 'location'],
        },
      },
      (args: unknown) =>
        _onTool(
          args,
          async ({ lat, lng, location }: { [key: string]: any }) => {
            setMarker({ lat, lng, location });
            setCoords({ lat, lng, location });
            const result = await fetch(
              `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,wind_speed_10m`,
            );
            const json = await result.json();
            const temperature = {
              value: json.current.temperature_2m as number,
              units: json.current_units.temperature_2m as string,
            };
            const wind_speed = {
              value: json.current.wind_speed_10m as number,
              units: json.current_units.wind_speed_10m as string,
            };
            setMarker({ lat, lng, location, temperature, wind_speed });
            console.log('Weather:', json);
            return json;
          },
        ),
    );
    client.addTool(
      {
        name: 'generate_image',
        description:
          "Generates an image using 'DALL·E 3' and shows it to the user.",
        parameters: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'The prompt for generating the image.',
            },
          },
          required: ['key'],
        },
      },
      (args: unknown) =>
        _onTool(args, async ({ prompt }: { prompt: string }) => {
          const openAI = openAIRef.current;
          const response = await openAI.images.generate({
            model: 'dall-e-3',
            prompt,
            n: 1,
            size: '1024x1024',
          });
          const image_url = response.data[0].url;
          setDisplayedImage(image_url || null);
          console.log(
            'setDisplayedImage()',
            client,
            client.realtime,
            client.realtime.ws,
            client.realtime.isConnected(),
          );
          return { ok: true, displayedToUser: true, image_url };
        }),
    );
    client.addTool(
      {
        name: 'search_related_topics',
        description:
          'Retrieves related topics and brief information using DuckDuckGo Instant Answer API based on the given query. This is not a traditional web search, but rather provides general information and related topics, including categorized results.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'The query to find related topics and general information.',
            },
          },
          required: ['query'],
        },
      },
      (args: unknown) =>
        _onTool(args, async ({ query }: { query: string }) => {
          // return await fetch(
          //   `http://localhost:8082/proxy?q=${encodeURIComponent(query)}`,
          // );

          try {
            const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`; // &kl=de-de see: https://duckduckgo.com/duckduckgo-help-pages/settings/params/
            const headers = {
              'accept-language': 'de-DE,en-US,en;q=0.9',
            };

            const response = await fetch(url, {
              headers,
            });

            const data = await response.json();

            const relatedTopics: Array<Record<string, string>> = [];
            data.RelatedTopics?.forEach((topic: any) => {
              if (topic.Topics) {
                // Handle nested topics with categories
                relatedTopics.push({
                  category: topic.Name,
                  topics: topic.Topics.filter(
                    (subTopic: any) => subTopic.FirstURL && subTopic.Text,
                  ).map((subTopic: any) => {
                    return {
                      title: subTopic.Text,
                      url: subTopic.FirstURL,
                      snippet: subTopic.Text,
                      icon_url: subTopic.Icon?.URL || null,
                    };
                  }),
                });
              } else if (topic.FirstURL && topic.Text) {
                // Handle top-level topics
                relatedTopics.push({
                  title: topic.Text,
                  url: topic.FirstURL,
                  snippet: topic.Text,
                  icon_url: topic.Icon?.URL || null,
                });
              }
            });
            if (relatedTopics.length === 0) {
              console.log({ url, args, query, data, relatedTopics });
            }
            return relatedTopics.length > 0
              ? { ok: true, relatedTopics }
              : { ok: false, message: 'No related topics found' };
          } catch (error) {
            console.error('Error retrieving related topics:', error);
            return { ok: false, message: 'Error retrieving related topics' };
          }
        }),
    );
    client.addTool(
      {
        name: 'wikipedia_search',
        description:
          'Searches Wikipedia for information based on the given query and returns a list of relevant search results.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query to find information on Wikipedia.',
            },
            language: {
              type: 'string',
              description:
                'The language code to use for Wikipedia search (e.g., en, de, fr). Defaults to en.',
            },
          },
          required: ['query'],
        },
      },
      async ({
        query,
        language = 'en',
      }: {
        query: string;
        language?: string;
      }) => {
        try {
          const response = await fetch(
            `https://${language}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`,
          );
          const data = await response.json();
          const searchResults = data?.query?.search?.map((result: any) => {
            return {
              title: result.title,
              snippet: result.snippet.replace(/<[^>]*>?/gm, ''), // Remove HTML tags from snippet
              pageid: result.pageid,
              url: `https://${language}.wikipedia.org/?curid=${result.pageid}`,
            };
          });

          return searchResults && searchResults.length > 0
            ? { ok: true, searchResults }
            : { ok: false, message: 'No search results found' };
        } catch (error) {
          console.error('Error searching Wikipedia:', error);
          return { ok: false, message: 'Error searching Wikipedia' };
        }
      },
    );
    client.addTool(
      {
        name: 'webpage_scrape',
        description:
          'Scrapes the content of a given webpage URL and returns the main text content converted to Markdown, useful for reading and understanding the content of web articles.',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL of the webpage to scrape.',
            },
          },
          required: ['url'],
        },
      },
      async ({ url }: { url: string }) => {
        try {
          const response = await fetch(
            `http://localhost:8082/scrape?url=${encodeURIComponent(url)}`,
          );
          if (!response.ok) {
            throw new Error(`Failed to fetch webpage: ${response.statusText}`);
          }
          const htmlContent = await response.text();

          if (!htmlContent.trim()) {
            return {
              ok: false,
              message: 'No text content found on the webpage',
            };
          }

          // Use Cheerio to parse and manipulate the HTML content
          const $ = cheerio.load(htmlContent);

          // Remove script, style, and other non-readable elements
          $(
            'script, style, noscript, iframe, header, footer, nav, aside, form, link, meta',
          ).remove();

          // Get the cleaned HTML content
          const cleanedHtmlContent = $('body').html() || '';

          // Convert cleaned HTML to Markdown
          const turndownService = new TurndownService();
          const markdownContent = turndownService.turndown(cleanedHtmlContent);

          console.log({ markdownContent });

          return { ok: true, markdownContent };
        } catch (error) {
          console.error('Error scraping webpage:', error);
          console.error({ url });
          return { ok: false, message: 'Error scraping webpage' };
        }
      },
    );

    // handle realtime events from client + server for event logging

    client.on('realtime.event', (realtimeEvent: RealtimeEvent) => {
      setRealtimeEvents((realtimeEvents) => {
        const lastEvent = realtimeEvents[realtimeEvents.length - 1];
        if (lastEvent?.event.type === realtimeEvent.event.type) {
          // if we receive multiple events in a row, aggregate them for display purposes
          lastEvent.count = (lastEvent.count || 0) + 1;
          return realtimeEvents.slice(0, -1).concat(lastEvent);
        } else {
          return realtimeEvents.concat(realtimeEvent);
        }
      });
    });
    client.on('error', (event: any) => console.error(event));
    client.on('conversation.interrupted', async () => {
      const trackSampleOffset = await wavStreamPlayer.interrupt();
      if (trackSampleOffset?.trackId) {
        const { trackId, offset } = trackSampleOffset;
        await client.cancelResponse(trackId, offset);
      }
    });
    client.on('conversation.updated', async ({ item, delta }: any) => {
      const items = client.conversation.getItems();
      if (delta?.audio) {
        wavStreamPlayer.add16BitPCM(delta.audio, item.id);
      }
      if (item.status === 'completed' && item.formatted.audio?.length) {
        const wavFile = await WavRecorder.decode(
          item.formatted.audio,
          24000,
          24000,
        );
        item.formatted.file = wavFile;
      }
      setItems(items);
    });

    setItems(client.conversation.getItems());

    return () => {
      // cleanup; resets to defaults
      client.reset();
    };
  }, []);

  /**
   * Render the application
   */
  return (
    <div data-component="ConsolePage">
      <div className="content-top">
        <div className="content-title">
          <img src="/openai-logomark.svg" alt="" />
          <span>realtime console</span>
        </div>
        <div className="content-api-key">
          {!LOCAL_RELAY_SERVER_URL && (
            <Button
              icon={Edit}
              iconPosition="end"
              buttonStyle="flush"
              label={`api key: ${apiKey.slice(0, 3)}...`}
              onClick={() => resetAPIKey()}
            />
          )}
        </div>
      </div>
      <div className="content-main">
        <div className="content-logs">
          <div className="content-block events">
            <div className="visualization">
              <div className="visualization-entry client">
                <canvas ref={clientCanvasRef} />
              </div>
              <div className="visualization-entry server">
                <canvas ref={serverCanvasRef} />
              </div>
            </div>
            <div
              className="content-block-title"
              onClick={() => toggleVisibility('events')}
            >
              events
            </div>
            {visibleBlocks.events && (
              <div className="content-block-body" ref={eventsScrollRef}>
                {!realtimeEvents.length && `awaiting connection...`}
                {realtimeEvents.map((realtimeEvent, i) => {
                  const count = realtimeEvent.count;
                  const event = { ...realtimeEvent.event };
                  if (event.type === 'input_audio_buffer.append') {
                    event.audio = `[trimmed: ${event.audio.length} bytes]`;
                  } else if (event.type === 'response.audio.delta') {
                    event.delta = `[trimmed: ${event.delta.length} bytes]`;
                  }
                  return (
                    <div className="event" key={event.event_id}>
                      <div className="event-timestamp">
                        {formatTime(realtimeEvent.time)}
                      </div>
                      <div className="event-details">
                        <div
                          className="event-summary"
                          onClick={() => {
                            // toggle event details
                            const id = event.event_id;
                            const expanded = { ...expandedEvents };
                            if (expanded[id]) {
                              delete expanded[id];
                            } else {
                              expanded[id] = true;
                            }
                            setExpandedEvents(expanded);
                          }}
                        >
                          <div
                            className={`event-source ${
                              event.type === 'error'
                                ? 'error'
                                : realtimeEvent.source
                            }`}
                          >
                            {realtimeEvent.source === 'client' ? (
                              <ArrowUp />
                            ) : (
                              <ArrowDown />
                            )}
                            <span>
                              {event.type === 'error'
                                ? 'error!'
                                : realtimeEvent.source}
                            </span>
                          </div>
                          <div className="event-type">
                            {event.type}
                            {count && ` (${count})`}
                          </div>
                        </div>
                        {!!expandedEvents[event.event_id] && (
                          <div className="event-payload">
                            {JSON.stringify(event, null, 2)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="content-block conversation">
            <div className="content-block-title">conversation</div>
            <div className="content-block-body" data-conversation-content>
              {!items.length && `awaiting connection...`}
              {items.map((conversationItem, i) => (
                <div className="conversation-item" key={conversationItem.id}>
                  <div className={`speaker ${conversationItem.role || ''}`}>
                    <div>
                      {(
                        conversationItem.role || conversationItem.type
                      ).replaceAll('_', ' ')}
                    </div>
                    <div
                      className="close"
                      onClick={() =>
                        deleteConversationItem(conversationItem.id)
                      }
                    >
                      <X />
                    </div>
                  </div>
                  <div className={`speaker-content`}>
                    {/* tool response */}
                    {conversationItem.type === 'function_call_output' && (
                      <div>{conversationItem.formatted.output}</div>
                    )}
                    {/* tool call */}
                    {!!conversationItem.formatted.tool && (
                      <div>
                        {conversationItem.formatted.tool.name}(
                        {conversationItem.formatted.tool.arguments})
                      </div>
                    )}
                    {!conversationItem.formatted.tool &&
                      conversationItem.role === 'user' && (
                        <div>
                          <Markdown>
                            {String(
                              conversationItem.formatted.transcript ||
                                (conversationItem.formatted.audio?.length
                                  ? '(awaiting transcript)'
                                  : conversationItem.formatted.text ||
                                    '(item sent)'),
                            )}
                          </Markdown>
                        </div>
                      )}
                    {!conversationItem.formatted.tool &&
                      conversationItem.role === 'assistant' && (
                        <div>
                          <Markdown>
                            {String(
                              conversationItem.formatted.transcript ||
                                conversationItem.formatted.text ||
                                '(truncated)',
                            )}
                          </Markdown>
                        </div>
                      )}
                    {conversationItem.formatted.file && showAudioControls && (
                      <audio
                        src={conversationItem.formatted.file.url}
                        controls
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="content-actions">
            <Toggle
              defaultValue={false}
              labels={['manual', 'vad']}
              values={['none', 'server_vad']}
              onChange={(_, value) => changeTurnEndType(value)}
            />
            <div className="spacer" />
            {isConnected && canPushToTalk && (
              <Button
                label={isRecording ? 'release to send' : 'push to talk'}
                buttonStyle={isRecording ? 'alert' : 'regular'}
                disabled={!isConnected || !canPushToTalk}
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
              />
            )}
            <div className="spacer" />
            <Button
              label={isConnected ? 'disconnect' : 'connect'}
              iconPosition={isConnected ? 'end' : 'start'}
              icon={isConnected ? X : Zap}
              buttonStyle={isConnected ? 'regular' : 'action'}
              onClick={
                isConnected ? disconnectConversation : connectConversation
              }
            />
          </div>
        </div>
        <div className="content-right">
          {coords && marker && (
            <div className="content-block map">
              {/* <div className="content-block-title">Map</div> */}
              <div className="content-block-title bottom">
                {marker.location || 'not yet retrieved'}
                {!!marker.temperature && (
                  <>
                    <br />
                    🌡️ {marker.temperature.value} {marker.temperature.units}
                  </>
                )}
                {!!marker.wind_speed && (
                  <>
                    {' '}
                    🍃 {marker.wind_speed.value} {marker.wind_speed.units}
                  </>
                )}
              </div>
              <div className="content-block-body full">
                {coords && (
                  <Map
                    center={[coords.lat, coords.lng]}
                    location={coords.location}
                  />
                )}
              </div>
            </div>
          )}
          {displayedImage && (
            <div className="content-block displayedImage">
              {/* <div className="content-block-title">Image</div> */}
              <div className="content-block-body content-displayedImage">
                <img src={displayedImage} alt="" />
              </div>
            </div>
          )}
          {information && (
            <div className="content-block information">
              <div className="content-block-title">Information</div>
              <div className="content-block-body content-information">
                <Markdown>{String(information)}</Markdown>
              </div>
            </div>
          )}
          {Object.keys(memory).length && (
            <div className="content-block memory">
              <div className="content-block-title">Memory</div>
              <div className="content-block-body content-memory">
                {JSON.stringify(memory, null, 2)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
