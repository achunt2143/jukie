// Package remux converts jukie-drm's decrypted output - Apple's fragmented MP4
// (moof/mdat, no top-level sample table) - into raw ADTS AAC.
//
// Why: the webOS device this plays on runs gst-launch-0.10 from ~2009-2010; its
// qtdemux element can't parse fragmented MP4 at all ("This file contains no
// playable streams" - confirmed on-device against a real decrypted track that
// plays fine in a modern player/computer, so the file itself is valid; qtdemux
// of that era predates routine fMP4/CMAF-style assets). ADTS AAC sidesteps MP4
// demuxing entirely - gst's typefind sniffs it directly regardless of the file's
// (misleading, but left as .m4a so the rest of the pipeline doesn't need to change)
// extension.
package remux

import (
	"bytes"
	"fmt"
	"os"

	"github.com/Eyevinn/mp4ff/aac"
	"github.com/Eyevinn/mp4ff/mp4"
)

// ToADTS reads the fragmented MP4 AAC file at path and overwrites it in place with
// raw ADTS AAC: a bare stream of frames, each carrying its own 7-byte header, no
// MP4 container at all.
func ToADTS(path string) error {
	in, err := os.Open(path)
	if err != nil {
		return err
	}
	f, err := mp4.DecodeFile(in)
	in.Close()
	if err != nil {
		return fmt.Errorf("parse mp4: %w", err)
	}
	if f.Init == nil || f.Init.Moov == nil || f.Init.Moov.Trak == nil {
		return fmt.Errorf("not a fragmented mp4 (no init segment/trak)")
	}
	trak := f.Init.Moov.Trak
	sd, err := trak.Mdia.Minf.Stbl.Stsd.GetSampleDescription(0)
	if err != nil {
		return fmt.Errorf("get sample description: %w", err)
	}
	audioSD, ok := sd.(*mp4.AudioSampleEntryBox)
	if !ok || audioSD.Esds == nil {
		return fmt.Errorf("not an AAC (mp4a/esds) audio track")
	}
	ascBytes := audioSD.Esds.DecConfigDescriptor.DecSpecificInfo.DecConfig
	asc, err := aac.DecodeAudioSpecificConfig(bytes.NewReader(ascBytes))
	if err != nil {
		return fmt.Errorf("decode AudioSpecificConfig: %w", err)
	}
	if asc.ObjectType != aac.AAClc {
		return fmt.Errorf("unsupported AAC object type %d (only AAC-LC/2 supported)", asc.ObjectType)
	}
	if f.Init.Moov.Mvex == nil || f.Init.Moov.Mvex.Trex == nil {
		return fmt.Errorf("no mvex/trex box (not a valid fragmented mp4)")
	}
	trex := f.Init.Moov.Mvex.Trex

	out := bytes.NewBuffer(nil)
	for _, seg := range f.Segments {
		for _, frag := range seg.Fragments {
			samples, err := frag.GetFullSamples(trex)
			if err != nil {
				return fmt.Errorf("get samples: %w", err)
			}
			for _, s := range samples {
				hdr, err := aac.NewADTSHeader(asc.SamplingFrequency, asc.ChannelConfiguration, asc.ObjectType, uint16(len(s.Data)))
				if err != nil {
					return fmt.Errorf("build ADTS header: %w", err)
				}
				out.Write(hdr.Encode())
				out.Write(s.Data)
			}
		}
	}
	if out.Len() == 0 {
		return fmt.Errorf("no audio samples found")
	}
	return os.WriteFile(path, out.Bytes(), 0666)
}
